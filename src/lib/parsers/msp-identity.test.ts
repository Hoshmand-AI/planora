import { describe, it, expect } from 'vitest'
import { alignMspIds } from './msp-identity'

const t = (activityId: string, sourceId: string | null) => ({ activityId, sourceId })

describe('MS Project task identity across updates', () => {
  it('changes nothing when no row was renumbered', () => {
    const next = [t('A1', '1'), t('A2', '2'), t('A3', '9')]
    expect(alignMspIds([t('A1', '1'), t('A2', '2')], next)).toMatchObject({ renumbered: 0, note: null })
    expect(next.map(a => a.activityId)).toEqual(['A1', 'A2', 'A3'])
  })
  it('a row inserted above keeps every earlier task on its earlier ID', () => {
    // Previous: rows 1..3 are UIDs 1, 2, 3. Now a new task (UID 7) sits in row 2, pushing UIDs 2 and 3 down.
    const next = [t('A1', '1'), t('A2', '7'), t('A3', '2'), t('A4', '3')]
    const r = alignMspIds([t('A1', '1'), t('A2', '2'), t('A3', '3')], next)
    expect(next.find(a => a.sourceId === '2')!.activityId).toBe('A2')
    expect(next.find(a => a.sourceId === '3')!.activityId).toBe('A3')
    expect(next.find(a => a.sourceId === '1')!.activityId).toBe('A1')
    // The new task's row number (2) is taken by the task that had it before.
    expect(next.find(a => a.sourceId === '7')!.activityId).toBe('A2-U7')
    expect(new Set(next.map(a => a.activityId)).size).toBe(4)
    expect(r).toMatchObject({ renumbered: 2, disambiguated: 1 })
    expect(r.note).toMatch(/Rows were renumbered in MS Project/)
  })
  it('a deleted row: the tasks below keep their earlier IDs and none collide', () => {
    const next = [t('A1', '1'), t('A2', '3'), t('A3', '4')]
    const r = alignMspIds([t('A1', '1'), t('A2', '2'), t('A3', '3'), t('A4', '4')], next)
    expect(next.map(a => a.activityId)).toEqual(['A1', 'A3', 'A4'])
    expect(r).toMatchObject({ renumbered: 2, disambiguated: 0 })
  })
  it('tasks with a code of their own are never touched, and their codes are never given away', () => {
    const next = [t('STEEL-10', '5'), t('A2', '8'), t('A3', '2')]
    alignMspIds([t('A2', '2'), t('STEEL-10', '5')], next)
    expect(next.map(a => a.activityId)).toEqual(['STEEL-10', 'A2-U8', 'A2'])
  })
  it('does nothing when the previous update has no row-numbered tasks or no Unique IDs', () => {
    const next = [t('A1', '1'), t('A2', '2')]
    expect(alignMspIds([t('X1', '2'), t('X2', '1')], next).note).toBeNull()
    expect(alignMspIds([t('A1', null), t('A2', null)], next).note).toBeNull()
    expect(next.map(a => a.activityId)).toEqual(['A1', 'A2'])
  })
  it('rows swapped: both tasks keep their earlier IDs', () => {
    const next = [t('A1', '2'), t('A2', '1')]
    alignMspIds([t('A1', '1'), t('A2', '2')], next)
    expect(next.find(a => a.sourceId === '1')!.activityId).toBe('A1')
    expect(next.find(a => a.sourceId === '2')!.activityId).toBe('A2')
  })
})
