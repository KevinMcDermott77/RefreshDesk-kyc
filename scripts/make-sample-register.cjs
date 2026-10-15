#!/usr/bin/env node
// Writes __fixtures__/evidence/SAMPLE-shareholder-register.pdf: an invented Norwegian shareholder
// register for trying out the client-evidence upload, extraction and confirm flow by hand.
//
//   node scripts/make-sample-register.cjs
//
// Everything in it is made up (the company, the registration numbers, the people) and every page
// is stamped SAMPLE. It is plain PDF 1.4 with the standard Helvetica fonts, so it needs no library.
// The layout is chosen to exercise the flow: Nordic letters in names, one entity shareholder with a
// registration number printed beside it, holdings that add up to 100% (so the coverage rule passes),
// a statement that the register lists every shareholder, an as-at date and a certification block.
const fs = require('node:fs')
const path = require('node:path')

const OUT = path.resolve(__dirname, '..', '__fixtures__', 'evidence', 'SAMPLE-shareholder-register.pdf')

// WinAnsi bytes for the few non-ASCII letters used (the standard fonts use WinAnsiEncoding).
const WIN_ANSI = { 'Ø': 0xd8, 'ø': 0xf8, 'Å': 0xc5, 'å': 0xe5, 'Æ': 0xc6, 'æ': 0xe6 }

function pdfString(text) {
  const bytes = []
  for (const ch of text) {
    const code = WIN_ANSI[ch] ?? ch.charCodeAt(0)
    if (code > 255) throw new Error(`character not supported by WinAnsi: ${ch}`)
    if (ch === '(' || ch === ')' || ch === '\\') bytes.push(0x5c)
    bytes.push(code)
  }
  return Buffer.from(bytes)
}

class Page {
  constructor() {
    this.parts = []
  }
  raw(s) {
    this.parts.push(Buffer.from(s + '\n', 'latin1'))
  }
  text(x, y, size, text, bold = false, gray = 0) {
    this.raw(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${gray} g ${x} ${y} Td (`)
    this.parts.push(pdfString(text))
    this.raw(') Tj ET')
  }
  line(x1, y1, x2, y2, width = 0.6) {
    this.raw(`${width} w ${x1} ${y1} m ${x2} ${y2} l S`)
  }
  rect(x, y, w, h, fill) {
    this.raw(`${fill} rg ${x} ${y} ${w} ${h} re f 0 g`)
  }
  watermark() {
    // Diagonal grey "SAMPLE" across the page, drawn first so the text stays readable on top.
    const c = Math.cos(Math.PI / 4)
    const s = Math.sin(Math.PI / 4)
    this.raw(`BT /F2 120 Tf 0.9 g ${c.toFixed(4)} ${s.toFixed(4)} ${(-s).toFixed(4)} ${c.toFixed(4)} 110 250 Tm (SAMPLE) Tj ET 0 g`)
  }
  content() {
    return Buffer.concat(this.parts)
  }
}

function pageOne() {
  const p = new Page()
  p.watermark()
  p.rect(40, 770, 515, 34, '0.85 0.1 0.1')
  p.raw('1 g')
  p.text(52, 782, 13, 'SAMPLE - INVENTED DOCUMENT FOR TESTING - NOT A REAL REGISTER', true, 1)
  p.text(50, 730, 20, 'AKSJEEIERBOK', true)
  p.text(50, 708, 12, 'Register of shareholders')
  p.line(50, 698, 545, 698, 1)

  const rows = [
    ['Company', 'Fjordvik Test Holding AS'],
    ['Organisation number', '999 000 001'],
    ['Registered office', 'Testgata 1, 0000 Testby, Norway'],
    ['Share capital', 'NOK 1,000,000'],
    ['Number of shares', '1,000 ordinary shares of NOK 1,000 each'],
    ['Position as at', '30 June 2026'],
    ['Date of this document', '15 July 2026'],
  ]
  let y = 668
  for (const [label, value] of rows) {
    p.text(50, y, 11, label, true)
    p.text(210, y, 11, value)
    y -= 24
  }

  p.text(50, y - 10, 11, 'This register lists all shareholders of the company. The shareholders and their')
  p.text(50, y - 26, 11, 'holdings are set out in Table 1 on page 2.')
  p.text(50, 60, 9, 'Page 1 of 2', false, 0.4)
  p.text(300, 60, 9, 'SAMPLE - every name and number in this document is invented.', false, 0.4)
  return p
}

function pageTwo() {
  const p = new Page()
  p.watermark()
  p.text(50, 780, 14, 'Table 1 - Shareholders as at 30 June 2026', true)
  p.text(50, 762, 10, 'Fjordvik Test Holding AS, org. no. 999 000 001', false, 0.3)

  const cols = [50, 78, 292, 392, 462, 545]
  const head = 736
  p.rect(50, head - 6, 495, 22, '0.92 0.92 0.92')
  p.text(cols[0] + 4, head, 10, 'No.', true)
  p.text(cols[1] + 4, head, 10, 'Shareholder', true)
  p.text(cols[2] + 4, head, 10, 'Org. no.', true)
  p.text(cols[3] + 4, head, 10, 'Shares', true)
  p.text(cols[4] + 4, head, 10, '% of capital', true)

  const holders = [
    ['1', 'Øystein Åsmund Testersen', '-', '400', '40.0 %'],
    ['2', 'Nordlys Invest Test AS', '999 000 002', '300', '30.0 %'],
    ['3', 'Kari Eksempel-Fjeld', '-', '150', '15.0 %'],
    ['4', 'Bjørn Prøve', '-', '100', '10.0 %'],
    ['5', 'Mia Sampleby', '-', '50', '5.0 %'],
  ]
  let y = head - 28
  for (const row of holders) {
    row.forEach((cell, i) => p.text(cols[i] + 4, y, 10, cell))
    p.line(50, y - 8, 545, y - 8, 0.3)
    y -= 26
  }
  p.text(cols[1] + 4, y, 10, 'Total', true)
  p.text(cols[3] + 4, y, 10, '1,000', true)
  p.text(cols[4] + 4, y, 10, '100.0 %', true)
  // Table frame.
  const top = head + 16
  const bottom = y - 10
  p.line(50, top, 545, top, 0.8)
  p.line(50, bottom, 545, bottom, 0.8)
  for (const x of cols) p.line(x, top, x, bottom, 0.5)

  p.text(50, bottom - 22, 9, 'Natural persons are shown by name only; personal identity numbers are not included.', false, 0.3)

  const boxTop = bottom - 60
  p.line(50, boxTop, 545, boxTop, 0.8)
  p.text(50, boxTop - 20, 11, 'Certification', true)
  p.text(50, boxTop - 40, 10.5, 'I certify that this is a true and complete copy of the register of shareholders of')
  p.text(50, boxTop - 55, 10.5, 'Fjordvik Test Holding AS as at 30 June 2026.')
  p.text(50, boxTop - 95, 10.5, '[signature]')
  p.line(50, boxTop - 100, 250, boxTop - 100, 0.6)
  p.text(50, boxTop - 115, 10.5, 'Sample Signatory, Company secretary')
  p.text(50, boxTop - 130, 10.5, 'Testby, 15 July 2026')
  p.text(50, 60, 9, 'Page 2 of 2', false, 0.4)
  p.text(300, 60, 9, 'SAMPLE - every name and number in this document is invented.', false, 0.4)
  return p
}

function build(pages) {
  // Objects: 1 catalog, 2 pages, 3 Helvetica, 4 Helvetica-Bold, then a page and a stream for each page.
  const objects = []
  const add = (body) => objects.push(Buffer.isBuffer(body) ? body : Buffer.from(body, 'latin1'))
  const kids = pages.map((_, i) => `${5 + i * 2} 0 R`).join(' ')
  add('<< /Type /Catalog /Pages 2 0 R >>')
  add(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`)
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>')
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>')
  pages.forEach((page, i) => {
    add(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${6 + i * 2} 0 R >>`,
    )
    const content = page.content()
    add(Buffer.concat([Buffer.from(`<< /Length ${content.length} >>\nstream\n`, 'latin1'), content, Buffer.from('endstream', 'latin1')]))
  })

  const chunks = [Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1')]
  const offsets = []
  let position = chunks[0].length
  objects.forEach((body, i) => {
    offsets.push(position)
    const chunk = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`, 'latin1'), body, Buffer.from('\nendobj\n', 'latin1')])
    chunks.push(chunk)
    position += chunk.length
  })
  const xref = [`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`]
  for (const offset of offsets) xref.push(`${String(offset).padStart(10, '0')} 00000 n \n`)
  xref.push(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${position}\n%%EOF\n`)
  chunks.push(Buffer.from(xref.join(''), 'latin1'))
  return Buffer.concat(chunks)
}

fs.mkdirSync(path.dirname(OUT), { recursive: true })
fs.writeFileSync(OUT, build([pageOne(), pageTwo()]))
console.log(`wrote ${path.relative(process.cwd(), OUT)}`)
