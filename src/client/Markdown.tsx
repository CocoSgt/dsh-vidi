import type { ReactNode } from 'react'

/**
 * Small, safe Markdown for chat replies: paragraphs, headings, lists, tables,
 * fenced code, **bold**, *italic*, `code`, [links](url). No raw HTML.
 * Paths inside the video folder become links that open the file.
 */
export function Markdown({ text, fileUrl }: { text: string; fileUrl?: (path: string) => string | undefined }) {
  const lines = text.replace(/\r/g, '').split('\n')
  const out: ReactNode[] = []
  let i = 0
  const inline = (s: string, key: string): ReactNode[] => {
    const parts: ReactNode[] = []
    const re = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*\s][^*]*\*|\[[^\]]+\]\((https?:\/\/[^)\s]+)\))/g
    let last = 0, m: RegExpExecArray | null, n = 0
    while ((m = re.exec(s))) {
      if (m.index > last) parts.push(s.slice(last, m.index))
      const tok = m[0]
      const k = `${key}-${n++}`
      if (tok.startsWith('`')) {
        const code = tok.slice(1, -1)
        const href = fileUrl?.(code)
        parts.push(href ? <a key={k} href={href} target="_blank" rel="noreferrer"><code>{code}</code></a> : <code key={k}>{code}</code>)
      } else if (tok.startsWith('**')) parts.push(<strong key={k}>{tok.slice(2, -2)}</strong>)
      else if (tok.startsWith('[')) { const mm = /\[([^\]]+)\]\(([^)]+)\)/.exec(tok)!; parts.push(<a key={k} href={mm[2]} target="_blank" rel="noreferrer">{mm[1]}</a>) }
      else parts.push(<em key={k}>{tok.slice(1, -1)}</em>)
      last = m.index + tok.length
    }
    if (last < s.length) parts.push(s.slice(last))
    return parts
  }
  while (i < lines.length) {
    const line = lines[i]!
    if (/^```/.test(line)) {
      const body: string[] = []
      i++
      while (i < lines.length && !/^```/.test(lines[i]!)) body.push(lines[i++]!)
      i++
      out.push(<pre key={i}><code>{body.join('\n')}</code></pre>)
      continue
    }
    if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1]!)) {
      const row = (l: string) => l.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim())
      const head = row(line)
      i += 2
      const body: string[][] = []
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i]!)) body.push(row(lines[i++]!))
      out.push(
        <table key={i}><thead><tr>{head.map((h, j) => <th key={j}>{inline(h, `h${i}${j}`)}</th>)}</tr></thead>
          <tbody>{body.map((r, a) => <tr key={a}>{r.map((c, b) => <td key={b}>{inline(c, `c${i}${a}${b}`)}</td>)}</tr>)}</tbody></table>,
      )
      continue
    }
    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line)
      const items: string[] = []
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i]!)) items.push(lines[i++]!.replace(/^\s*([-*]|\d+\.)\s+/, ''))
      const lis = items.map((it, j) => <li key={j}>{inline(it, `l${i}${j}`)}</li>)
      out.push(ordered ? <ol key={i}>{lis}</ol> : <ul key={i}>{lis}</ul>)
      continue
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line)
    if (h) { out.push(<p key={i} className="h">{inline(h[2]!, `t${i}`)}</p>); i++; continue }
    if (!line.trim()) { i++; continue }
    const para: string[] = []
    while (i < lines.length && lines[i]!.trim() && !/^(```|#{1,4}\s|\s*([-*]|\d+\.)\s+|\s*\|.*\|\s*$)/.test(lines[i]!)) para.push(lines[i++]!)
    if (!para.length) { para.push(line); i++ }
    out.push(<p key={i}>{inline(para.join('\n'), `p${i}`)}</p>)
  }
  return <div className="md">{out}</div>
}
