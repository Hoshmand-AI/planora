// Single entry point for schedule-file ingestion.

import type { ParsedSchedule } from './types'
import { parseXER } from './xer-parser'
import { parseMSProjectXML } from './xml-parser'
import { parsePDF } from './pdf-parser'
import { parseSpreadsheet } from './excel-parser'

export type { ParsedSchedule, ParsedSourceType } from './types'
export { parseXER } from './xer-parser'
export { parseMSProjectXML } from './xml-parser'
export { parsePDF } from './pdf-parser'
export { parseSpreadsheet } from './excel-parser'

export const SUPPORTED_EXTENSIONS = ['.xer', '.xml', '.pdf', '.xlsx', '.csv'] as const

/** Decode text: honours UTF-8/UTF-16 BOMs; falls back to Windows-1252-ish latin1 for non-UTF-8 files (common for XER). */
function decodeText(data: Buffer): string {
  if (data.length >= 2 && data[0] === 0xff && data[1] === 0xfe) return new TextDecoder('utf-16le').decode(data.subarray(2))
  if (data.length >= 2 && data[0] === 0xfe && data[1] === 0xff) return new TextDecoder('utf-16be').decode(data.subarray(2))
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(data).replace(/^﻿/, '')
  } catch {
    return data.toString('latin1')
  }
}

export async function parseScheduleFile(fileName: string, data: Buffer, scheduleId: string, opts: { projectId?: string | null } = {}): Promise<ParsedSchedule> {
  const ext = (fileName.toLowerCase().match(/\.[a-z0-9]+$/) || [''])[0]
  switch (ext) {
    case '.xer':
      return parseXER(decodeText(data), scheduleId, opts)
    case '.xml': {
      const text = decodeText(data)
      if (/<APIBusinessObjects[\s>]/.test(text)) {
        throw new Error('This is a Primavera P6 XML (PMXML) file, which is not supported — export the project from P6 as .xer instead')
      }
      if (!/<Project[\s>]/.test(text) || !/<Tasks[\s>]/.test(text)) {
        throw new Error('XML file is not a Microsoft Project XML export (no <Project>/<Tasks>) — in MS Project use File › Save As › XML')
      }
      return parseMSProjectXML(text, scheduleId)
    }
    case '.pdf':
      return parsePDF(data, scheduleId)
    case '.xlsx':
    case '.xlsm':
    case '.csv':
      return parseSpreadsheet(data, fileName, scheduleId)
    case '.mpp':
      throw new Error('Native .mpp files are binary — export from MS Project as XML (File › Save As › XML format) and upload the .xml')
    case '.xls':
      throw new Error('Legacy .xls workbooks are not supported — save as .xlsx or .csv and upload again')
    case '.pmxml':
      throw new Error('Primavera P6 XML is not supported — export the project from P6 as .xer instead')
    case '.pp':
    case '.ppx':
      throw new Error('Asta Powerproject files are not supported — export to MS Project XML or .xlsx/.csv')
    default:
      throw new Error(`Unsupported file type "${ext || fileName}". Upload a P6 .xer, MS Project .xml, .xlsx, .csv, or .pdf schedule`)
  }
}
