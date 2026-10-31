import { afterEach, describe, expect, it, vi } from 'vitest'
import { brandedFilename, downloadBrandedTable, newBrandedWorkbook, safeCell } from './branded-export'
import { suggestedQuantity } from './purchasing-api'

describe('Nifunze-branded Excel downloads', () => {
  afterEach(() => vi.restoreAllMocks())

  it('names every download nifunze-*', () => {
    expect(brandedFilename('stock-page.xlsx')).toBe('nifunze-stock-page.xlsx')
    expect(brandedFilename('hekima-suppliers.xlsx')).toBe('nifunze-suppliers.xlsx')
    expect(brandedFilename('nifunze-sales.xlsx')).toBe('nifunze-sales.xlsx')
  })

  it('keeps exported text from running as a formula', () => {
    expect(safeCell('=HYPERLINK("x")')).toBe(`'=HYPERLINK("x")`)
    expect(safeCell('Atlas')).toBe('Atlas')
    expect(safeCell(12)).toBe(12)
  })

  it('writes a branded banner, header and footer around the table', async () => {
    let blob: Blob | null = null
    let filename = ''
    vi.spyOn(URL, 'createObjectURL').mockImplementation(value => { blob = value as Blob; return 'blob:test' })
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { filename = this.download })

    await downloadBrandedTable({
      filename: 'suppliers.xlsx', sheetName: 'Suppliers', title: 'Suppliers', bookshopName: 'Kisumu Readers',
      columns: [{ header: 'Name' }, { header: 'Lead time', numFmt: '0' }], rows: [['KR Publishers', 5]],
    })

    expect(filename).toBe('nifunze-suppliers.xlsx')
    const ExcelJS = (await import('exceljs')).default
    const workbook = new ExcelJS.Workbook()
    const bytes = await new Promise<ArrayBuffer>(resolve => { const reader = new FileReader(); reader.onload = () => resolve(reader.result as ArrayBuffer); reader.readAsArrayBuffer(blob!) })
    await workbook.xlsx.load(bytes)
    const sheet = workbook.getWorksheet('Suppliers')!
    expect(workbook.creator).toBe('Nifunze Bookshop')
    expect(sheet.getCell('A1').value).toBe('NIFUNZE BOOKSHOP')
    expect(sheet.getCell('A2').value).toBe('Suppliers · Kisumu Readers')
    expect(sheet.getCell('A5').value).toBe('Name')
    expect(sheet.getCell('A6').value).toBe('KR Publishers')
    expect(String(sheet.getCell('A8').value)).toContain('Generated using Nifunze Bookshop')
    expect(sheet.headerFooter.oddFooter).toContain('Generated using Nifunze Bookshop')
  })

  it('brands template workbooks without moving their header row', async () => {
    const workbook = await newBrandedWorkbook('Stock count', 'Kisumu Readers')
    expect(workbook.company).toBe('Kisumu Readers')
    expect(workbook.description).toBe('Generated using Nifunze Bookshop')
  })
})

describe('reorder suggestion maths', () => {
  it('orders target minus available minus on-order, never negative, in whole packs', () => {
    expect(suggestedQuantity(3, 30, 10)).toBe(17)
    expect(suggestedQuantity(40, 30, 0)).toBe(0)
    expect(suggestedQuantity(3, 30, 10, null, 12)).toBe(24)
    expect(suggestedQuantity(3, 30, 10, 50)).toBe(50)
  })
})
