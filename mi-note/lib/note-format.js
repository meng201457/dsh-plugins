/**
 * Xiaomi note body <-> Markdown.
 *
 * The cloud bodies are not XML documents. A note's `content` is a flat
 * fragment with one block element per line, no root element and no namespace,
 * and the phone client often prefixes it with a `<new-format/>` marker. Lists
 * are self-closing tags with the item text AFTER the tag:
 *
 *   <order indent="1" inputNumber="1" />第一段
 *   <bullet indent="2" />子项
 *
 * `indent` is 1-based (indent 1 is the outermost level), which is why every
 * reader here subtracts one before repeating an indent unit.
 *
 * The conversion is deliberately lossy in the same places the platform is:
 * there are no tags for code fences, tables, links, footnotes or headings
 * below H3, so those survive as literal text. `analyse()` reports what a
 * Markdown file would lose, which is what the pre-flight check in the sync
 * tool uses instead of guessing.
 *
 * Format facts and the round-trip fixtures this file is tested against come
 * from mi-note-cli (https://github.com/ceynri/mi-note-cli),
 * Copyright (c) 2026 ceynri, MIT License. See docs/reference-format.md.
 */

const INDENT_UNIT = '  '
const QUOTE_NEWLINE = '\u2028'

/* --------------------------------------------------------------- entities */

const ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
}

export function decodeHtmlEntities(text) {
  return String(text).replace(/&([a-z]+);/gi, (whole, name) => {
    const key = String(name).toLowerCase()
    return Object.prototype.hasOwnProperty.call(ENTITIES, key) ? ENTITIES[key] : whole
  })
}

/** Escape only the three characters the platform escapes. */
export function escapeXml(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** `BBGGRR` (the platform's order) to `#RRGGBB`. */
function bgrToRgb(value) {
  const raw = String(value)
  if (raw.length < 6) return raw
  const trimmed = raw.slice(-6)
  return '#' + trimmed.slice(4, 6) + trimmed.slice(2, 4) + trimmed.slice(0, 2)
}

/* -------------------------------------------------------- inline elements */

/**
 * Convert the inline markup of one block's inner text to Markdown.
 * A size tag that fills a whole line is upgraded to a heading by the caller;
 * anywhere else it degrades to bold, exactly like a heading-tag used inline.
 */
function inlineToMarkdown(raw) {
  let text = String(raw)
  text = text.replace(/<size>([\s\S]*?)<\/size>/g, '**$1**')
  text = text.replace(/<mid-size>([\s\S]*?)<\/mid-size>/g, '**$1**')
  text = text.replace(/<h3-size>([\s\S]*?)<\/h3-size>/g, '**$1**')
  text = text.replace(/<b>([\s\S]*?)<\/b>/g, '**$1**')
  text = text.replace(/<i>([\s\S]*?)<\/i>/g, '*$1*')
  text = text.replace(/<delete>([\s\S]*?)<\/delete>/g, '~~$1~~')
  text = text.replace(/<u>([\s\S]*?)<\/u>/g, '<u>$1</u>')
  text = text.replace(
    /<background\s+color="([^"]+)">([\s\S]*?)<\/background>/g,
    (_whole, color, inner) => '<mark style="background:' + bgrToRgb(color) + '">' + inner + '</mark>',
  )
  return decodeHtmlEntities(text)
}

const HEADING_TAGS = [
  [/^<size>([\s\S]*?)<\/size>$/, '#'],
  [/^<mid-size>([\s\S]*?)<\/mid-size>$/, '##'],
  [/^<h3-size>([\s\S]*?)<\/h3-size>$/, '###'],
]

/* ------------------------------------------------------------ xml -> md */

/**
 * Convert one note body to Markdown.
 * @param {string} content - the note's `content` fragment.
 * @returns {string} Markdown text, without a trailing newline.
 */
export function xmlToMarkdown(content) {
  const normalized = String(content ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/<new-format\s*\/>/g, '')
    .replace(/<0\s*\/>/g, '')
    // Images carry no registry here, so they become the platform's own
    // `minote://` reference and stay traceable back to the cloud file id.
    .replace(/<img\s+[^>]*fileid="([^"]+)"[^>]*\/>/g, (_whole, fileId) => '![](minote://image/' + fileId + ')')
    // Audio and video need an attachment registry this version does not read;
    // keep a visible placeholder instead of dropping the line.
    .replace(/<(sound|video)\s+[^>]*?(?:id|fileid|data)="([^"]*)"[^>]*\/>/g, (_whole, kind, id) =>
      '[附件：' + kind + ' ' + id + ']',
    )

  // A quote is the one block that may span lines: fold its inner newlines so it
  // becomes a single token, then restore them when rendering.
  const folded = normalized.replace(/<quote>([\s\S]*?)<\/quote>/g, (_whole, inner) =>
    '<quote>' + inner.replace(/\n/g, QUOTE_NEWLINE) + '</quote>',
  )

  const blocks = []
  const orderCounters = new Map()

  const resetOrderCounters = () => orderCounters.clear()

  for (const rawLine of folded.split('\n')) {
    const line = rawLine.trim()
    if (line === '') continue

    let match = /^<order\s+indent="(\d+)"(?:\s+inputNumber="(\d+)")?\s*\/>(.*)$/.exec(line)
    if (match !== null) {
      const level = Math.max(0, Number(match[1]) - 1)
      const explicit = match[2] === undefined ? 0 : Number(match[2])
      const next = explicit > 0 ? explicit : (orderCounters.get(level) ?? 0) + 1
      orderCounters.set(level, next)
      blocks.push({
        type: 'order',
        level,
        number: next,
        text: INDENT_UNIT.repeat(level) + next + '. ' + inlineToMarkdown(match[3]).trim(),
      })
      continue
    }

    match = /^<bullet\s+indent="(\d+)"\s*\/>(.*)$/.exec(line)
    if (match === null) match = /^<bullet(?:\s+indent="(\d+)")?\s*>([\s\S]*?)<\/bullet>$/.exec(line)
    if (match !== null) {
      const level = Math.max(0, Number(match[1] ?? 1) - 1)
      resetOrderCounters()
      blocks.push({
        type: 'bullet',
        level,
        text: INDENT_UNIT.repeat(level) + '- ' + inlineToMarkdown(match[2]).trim(),
      })
      continue
    }

    match = /^<input\s+([^>]*?)type="checkbox"([^>]*?)\s*\/>(.*)$/.exec(line)
    if (match !== null) {
      const attributes = (match[1] ?? '') + ' ' + (match[2] ?? '')
      const indentMatch = /indent="(\d+)"/.exec(attributes)
      const level = Math.max(0, Number(indentMatch === null ? 1 : indentMatch[1]) - 1)
      const checked = /checked="true"/.test(attributes)
      resetOrderCounters()
      blocks.push({
        type: 'checkbox',
        level,
        text: INDENT_UNIT.repeat(level) + '- [' + (checked ? 'x' : ' ') + '] ' + inlineToMarkdown(match[3]).trim(),
      })
      continue
    }

    match = /^<quote>([\s\S]*?)<\/quote>$/.exec(line)
    if (match !== null) {
      const inner = match[1].replace(new RegExp(QUOTE_NEWLINE, 'g'), '\n')
      const lines = []
      const innerPattern = /<text(?:\s+indent="\d+")?\s*>([\s\S]*?)<\/text>/g
      let innerMatch
      while ((innerMatch = innerPattern.exec(inner)) !== null) lines.push(inlineToMarkdown(innerMatch[1]).trim())
      if (lines.length === 0) {
        const plain = inner.replace(/<[^>]*>/g, '').trim()
        if (plain !== '') lines.push(inlineToMarkdown(plain))
      }
      if (lines.length > 0) {
        resetOrderCounters()
        blocks.push({ type: 'quote', text: lines.map(text => '> ' + text).join('\n') })
      }
      continue
    }

    match = /^<text(?:\s+indent="(\d+)")?\s*>([\s\S]*?)<\/text>$/.exec(line)
    if (match !== null) {
      const level = Math.max(0, Number(match[1] ?? 1) - 1)
      const inner = match[2].trim()
      resetOrderCounters()
      if (inner === '') {
        blocks.push({ type: 'blank', text: '' })
        continue
      }
      const heading = HEADING_TAGS.find(([pattern]) => pattern.test(inner))
      if (heading !== undefined) {
        const text = decodeHtmlEntities(heading[0].exec(inner)[1]).trim()
        if (text === '') {
          blocks.push({ type: 'blank', text: '' })
        } else {
          blocks.push({ type: 'heading', text: heading[1] + ' ' + text })
        }
        continue
      }
      const text = inlineToMarkdown(inner)
      blocks.push({ type: text.trim() === '' ? 'blank' : 'text', text: INDENT_UNIT.repeat(level) + text })
      continue
    }

    if (/^<hr\s*\/>$/.test(line)) {
      resetOrderCounters()
      blocks.push({ type: 'hr', text: '---' })
      continue
    }

    match = /^<align\s+align="(center|left|right)">([\s\S]*?)<\/align>$/.exec(line)
    if (match !== null) {
      resetOrderCounters()
      const text = inlineToMarkdown(match[2]).trim()
      if (text !== '') blocks.push({ type: 'align', text: '<div align="' + match[1] + '">' + text + '</div>' })
      continue
    }

    // Unknown element: keep its text, mark the line as a paragraph so the
    // result stays readable instead of dropping content silently.
    const stripped = inlineToMarkdown(line.replace(/<[^>]*>/g, '')).trim()
    if (stripped !== '') {
      resetOrderCounters()
      blocks.push({ type: 'text', text: stripped })
    }
  }

  const isList = block => block.type === 'order' || block.type === 'bullet' || block.type === 'checkbox'
  const needsBlankLine = (previous, current) => {
    if (previous === null) return false
    if (previous.type === current.type && isList(current)) return false
    if (previous.type === 'text' && current.type === 'text') return true
    if (previous.type === 'heading' || current.type === 'heading') return true
    if (previous.type === 'hr' || current.type === 'hr') return true
    if (previous.type === 'quote' || current.type === 'quote') return true
    if (isList(previous) !== isList(current)) return true
    return false
  }

  const out = []
  let previous = null
  for (const block of blocks) {
    if (needsBlankLine(previous, block)) out.push('')
    out.push(block.text)
    previous = block.type === 'blank' ? null : block
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

/* ------------------------------------------------------------ md -> xml */

const IMAGE_LINE = /^!\[([^\]]*)\]\(minote:\/\/image\/([^)]+)\)$/
const HEADING_LINE = /^(#{1,3})\s+(.*)$/
const HR_LINE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/
const CHECKBOX_LINE = /^(\s*)[-*+]\s+\[([ xX])\]\s+(.*)$/
const BULLET_LINE = /^(\s*)[-*]\s+(.*)$/
const ORDER_LINE = /^(\s*)(\d+)\.\s+(.*)$/
const QUOTE_LINE = /^\s*>\s?(.*)$/

/** Visible width of leading whitespace, counting a tab as four columns. */
function indentWidth(leading) {
  let width = 0
  for (const character of leading) width += character === '\t' ? 4 : 1
  return width
}

/** Escape text while keeping any literal `<u>` the user wrote intact. */
function escapeWithUnderline(text) {
  const kept = []
  const masked = text.replace(/<u>([\s\S]*?)<\/u>/g, (_whole, inner) => {
    kept.push('<u>' + escapeXml(inner) + '</u>')
    return '\u0000U' + (kept.length - 1) + '\u0000'
  })
  let out = escapeXml(masked)
  out = out.replace(/\u0000U(\d+)\u0000/g, (_whole, index) => kept[Number(index)])
  return out
}

/** Apply the inline Markdown the platform understands to one escaped line. */
function inlineToXml(text) {
  let out = escapeWithUnderline(text)
  out = out.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
  out = out.replace(/(?<!\*)\*(?!\*)([^*]+?)\*(?!\*)/g, '<i>$1</i>')
  out = out.replace(/~~(.+?)~~/g, '<delete>$1</delete>')
  return out
}

/**
 * Convert Markdown to a note body fragment.
 *
 * Code fences, tables, links and H4-H6 have no representation on the platform,
 * so they pass through as paragraph text rather than being dropped: the result
 * is still readable on the phone, and `analyse()` warns about the loss.
 * @param {string} markdown
 * @returns {string}
 */
export function markdownToXml(markdown) {
  const lines = String(markdown ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  const out = []
  const stack = []

  const levelFor = leading => {
    const width = indentWidth(leading)
    if (width === 0) {
      stack.length = 0
      stack.push(0)
      return 1
    }
    while (stack.length > 1 && width < stack[stack.length - 1]) stack.pop()
    if (width > stack[stack.length - 1]) stack.push(width)
    return stack.length
  }

  const resetStack = () => {
    stack.length = 0
  }

  let index = 0
  while (index < lines.length) {
    const line = lines[index]
    index += 1

    const imageMatch = IMAGE_LINE.exec(line.trim())
    if (imageMatch !== null) {
      resetStack()
      out.push('<img fileid="' + imageMatch[2] + '" imgshow="0" imgdes="" />')
      continue
    }

    const headingMatch = HEADING_LINE.exec(line)
    if (headingMatch !== null) {
      resetStack()
      const markers = { 1: 'size', 2: 'mid-size', 3: 'h3-size' }
      const tag = markers[headingMatch[1].length]
      out.push('<text indent="1"><' + tag + '>' + inlineToXml(headingMatch[2].trim()) + '</' + tag + '></text>')
      continue
    }

    if (HR_LINE.test(line)) {
      resetStack()
      out.push('<hr />')
      continue
    }

    const quoteMatch = QUOTE_LINE.exec(line)
    if (quoteMatch !== null) {
      resetStack()
      const quoted = [quoteMatch[1].trim()]
      while (index < lines.length) {
        const nextQuote = QUOTE_LINE.exec(lines[index])
        if (nextQuote === null) break
        quoted.push(nextQuote[1].trim())
        index += 1
      }
      const body = quoted.map(text => '<text indent="1">' + inlineToXml(text) + '</text>').join('\n')
      out.push('<quote>' + body + '</quote>')
      continue
    }

    const checkboxMatch = CHECKBOX_LINE.exec(line)
    if (checkboxMatch !== null) {
      const level = levelFor(checkboxMatch[1])
      const checked = checkboxMatch[2].toLowerCase() === 'x' ? ' checked="true"' : ''
      out.push(
        '<input type="checkbox" indent="' + level + '" level="3"' + checked + ' />'
        + inlineToXml(checkboxMatch[3].trim()),
      )
      continue
    }

    const bulletMatch = BULLET_LINE.exec(line)
    if (bulletMatch !== null) {
      const level = levelFor(bulletMatch[1])
      out.push('<bullet indent="' + level + '" />' + inlineToXml(bulletMatch[2].trim()))
      continue
    }

    const orderMatch = ORDER_LINE.exec(line)
    if (orderMatch !== null) {
      const level = levelFor(orderMatch[1])
      out.push('<order indent="' + level + '" inputNumber="' + Number(orderMatch[2]) + '" />' + inlineToXml(orderMatch[3].trim()))
      continue
    }

    if (line.trim() === '') {
      out.push('<text indent="1"></text>')
      continue
    }

    resetStack()
    const leadingTab = line.startsWith('\t')
    const body = leadingTab ? line.slice(1) : line
    out.push('<text indent="' + (leadingTab ? 2 : 1) + '">' + inlineToXml(body.trim()) + '</text>')
  }

  while (out.length > 0 && out[out.length - 1] === '<text indent="1"></text>') out.pop()
  return out.join('\n')
}

/* --------------------------------------------------------------- analysis */

/** Markdown constructs this platform cannot represent. */
const LOSSY_RULES = [
  { kind: 'code-fence', label: '代码块会退化为普通段落（没有代码块标签，语言标识只作文字保留）', test: line => /^\s*```/.test(line) },
  { kind: 'table', label: '表格会退化为逐行段落（`|` 原样保留，不再是表格）', test: line => /^\s*\|.*\|\s*$/.test(line) },
  { kind: 'heading-deep', label: 'H4 及以下标题退化为普通段落', test: line => /^#{4,6}\s+/.test(line) },
  { kind: 'link', label: '链接退化为纯文本，手机上不可点击', test: line => /\[[^\]]+\]\((?!minote:\/\/image\/)[^)]+\)/.test(line) },
  { kind: 'footnote', label: '脚注退化为纯文本', test: line => /\[\^[^\]]+\]/.test(line) },
  { kind: 'html', label: '内嵌 HTML 除 `<u>` 外会变成字面字符', test: line => /<(?!\/?u>)([a-zA-Z][\w-]*)[^>]*>/.test(line) },
  { kind: 'image-inline', label: '图片必须独占一行，否则不会转成附件', test: line => /!\[[^\]]*\]\(/.test(line) && IMAGE_LINE.exec(line.trim()) === null },
]

/**
 * Report what publishing this Markdown would change on the phone.
 *
 * The result is what the pre-flight step shows: the issues, their line
 * numbers, and whether anything that must survive (numbers, units, explicit
 * references) is at risk. A `code-fence` or `table` issue is informational; an
 * inline image is blocking because the picture would simply not appear.
 * @param {string} markdown
 * @returns {{ issues: Array<{ kind: string, label: string, line: number, blocking: boolean }>, blocking: boolean }}
 */
export function analyse(markdown) {
  const lines = String(markdown ?? '').replace(/\r\n/g, '\n').split('\n')
  const issues = []
  const seen = new Set()
  let inFence = false
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (/^\s*```/.test(line)) {
      if (!inFence && !seen.has('code-fence')) {
        seen.add('code-fence')
        issues.push({ kind: 'code-fence', label: LOSSY_RULES[0].label, line: index + 1, blocking: false })
      }
      inFence = !inFence
      continue
    }
    if (inFence) continue
    for (const rule of LOSSY_RULES) {
      if (rule.kind === 'code-fence') continue
      if (!rule.test(line)) continue
      if (seen.has(rule.kind)) continue
      seen.add(rule.kind)
      issues.push({
        kind: rule.kind,
        label: rule.label,
        line: index + 1,
        blocking: rule.kind === 'image-inline',
      })
    }
  }
  return { issues, blocking: issues.some(issue => issue.blocking) }
}

export { INDENT_UNIT }
