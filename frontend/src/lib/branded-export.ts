import type { Workbook, Worksheet, Row } from 'exceljs'

/**
 * Nifunze Bookshop branding for every Excel file the app produces.
 *
 * Reports (exports people read) get a branded banner above the table. Templates that are filled in
 * and uploaded again keep their header on row 1 so they still import, and carry the branding in the
 * header colours, workbook properties, print header/footer and a branded instructions sheet.
 */
export const PLATFORM_BRAND = 'Nifunze Bookshop'
const BLUE = 'FF0071F9'
const PINK = 'FFF881BA'
const INK = 'FF14213D'
const MUTED = 'FF5B6577'
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

export type BrandedColumn = { header: string; width?: number; numFmt?: string }

export async function newBrandedWorkbook(title: string, bookshopName?: string | null): Promise<Workbook> {
  const ExcelJS = (await import('exceljs')).default
  const workbook = new ExcelJS.Workbook()
  workbook.creator = PLATFORM_BRAND
  workbook.lastModifiedBy = PLATFORM_BRAND
  workbook.company = bookshopName || PLATFORM_BRAND
  workbook.title = title
  workbook.subject = `${title}${bookshopName ? ` · ${bookshopName}` : ''}`
  workbook.description = `Generated using ${PLATFORM_BRAND}`
  workbook.keywords = 'Nifunze Bookshop'
  workbook.created = new Date()
  workbook.modified = new Date()
  return workbook
}

/** Nifunze blue header with white bold text. */
export function styleBrandedHeader(row: Row) {
  row.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLUE } }
  row.alignment = { vertical: 'middle' }
  row.height = 22
}

/** Printed pages show the bookshop and report on top and "Generated using Nifunze Bookshop" below. */
export function applyPrintBranding(sheet: Worksheet, title: string, bookshopName?: string | null) {
  const safe = (value: string) => value.replace(/&/g, '&&')
  sheet.headerFooter.oddHeader = `&L&B${safe(bookshopName || PLATFORM_BRAND)}&R${safe(title)}`
  sheet.headerFooter.oddFooter = `&LGenerated using ${PLATFORM_BRAND}&RPage &P of &N`
  sheet.pageSetup = { ...sheet.pageSetup, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 }
}

/** A branded cover/instructions sheet for templates. */
export function addBrandedInfoSheet(workbook: Workbook, name: string, title: string, lines: (string | [string, string])[], bookshopName?: string | null) {
  const sheet = workbook.addWorksheet(name, { properties: { tabColor: { argb: PINK } } })
  sheet.getColumn(1).width = 105
  sheet.getColumn(2).width = 36
  writeBanner(sheet, title, bookshopName, 2)
  for (const line of lines) sheet.addRow(Array.isArray(line) ? line : [line])
  sheet.addRow([])
  const footer = sheet.addRow([`Powered by ${PLATFORM_BRAND}`])
  footer.font = { italic: true, color: { argb: BLUE }, size: 9 }
  return sheet
}

/** A read-only report: banner, table with branded header, totals-friendly formats and a footer line. */
export async function downloadBrandedTable({ filename, sheetName, title, bookshopName, subtitle, columns, rows }: {
  filename: string; sheetName: string; title: string; bookshopName?: string | null; subtitle?: string
  columns: BrandedColumn[]; rows: (string | number | null | undefined)[][]
}) {
  const workbook = await newBrandedWorkbook(title, bookshopName)
  const sheet = workbook.addWorksheet(sheetName, { properties: { tabColor: { argb: BLUE } } })
  columns.forEach((column, index) => { sheet.getColumn(index + 1).width = column.width ?? 18 })
  const headerRow = writeBanner(sheet, title, bookshopName, columns.length, subtitle) + 1
  styleBrandedHeader(sheet.addRow(columns.map(column => column.header)))
  for (const values of rows) {
    const row = sheet.addRow(values.map(value => value ?? ''))
    columns.forEach((column, index) => { if (column.numFmt) row.getCell(index + 1).numFmt = column.numFmt })
  }
  if (rows.length) sheet.autoFilter = { from: { row: headerRow, column: 1 }, to: { row: headerRow, column: columns.length } }
  sheet.views = [{ state: 'frozen', ySplit: headerRow }]
  sheet.addRow([])
  const footer = sheet.addRow([`Generated using ${PLATFORM_BRAND} · ${new Date().toLocaleString('en-KE')}`])
  footer.font = { italic: true, color: { argb: MUTED }, size: 9 }
  applyPrintBranding(sheet, title, bookshopName)
  await downloadWorkbook(workbook, filename)
}

export async function downloadWorkbook(workbook: Workbook, filename: string) {
  const buffer = await workbook.xlsx.writeBuffer()
  const url = URL.createObjectURL(new Blob([buffer as BlobPart], { type: XLSX_TYPE }))
  const link = document.createElement('a')
  link.href = url
  link.download = brandedFilename(filename)
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000)
}

/** Every downloaded file name starts with "nifunze-". */
export function brandedFilename(name: string) {
  const clean = name.replace(/^(hekima|nifunze)-/i, '')
  return `nifunze-${clean}`
}

/** Excel would run text starting with = + - @ as a formula; prefix it so exported data stays data. */
export const safeCell = (value: string | number | null | undefined) =>
  typeof value === 'string' && /^[=+\-@\t\r]/.test(value) ? `'${value}` : value

/** Rows 1-3: brand strip, report title and bookshop, generated time. Returns the last banner row number. */
function writeBanner(sheet: Worksheet, title: string, bookshopName: string | null | undefined, width: number, subtitle?: string) {
  const span = Math.max(width, 2)
  const brand = sheet.addRow([PLATFORM_BRAND.toUpperCase()])
  brand.font = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } }
  brand.height = 20
  for (let column = 1; column <= span; column++) brand.getCell(column).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: column === span ? PINK : BLUE } }
  const heading = sheet.addRow([bookshopName ? `${title} · ${bookshopName}` : title])
  heading.font = { bold: true, size: 15, color: { argb: INK } }
  heading.height = 24
  const meta = sheet.addRow([`${subtitle ? `${subtitle} · ` : ''}Generated ${new Date().toLocaleString('en-KE')}`])
  meta.font = { size: 9, color: { argb: MUTED } }
  sheet.addRow([])
  return 4
}
