import { describe, expect, it } from 'vitest'
import { cleanFolderName, messagesUrl, pickFolder, SYNC_BATCH } from './project-mailbox'

describe('project mailbox helpers', () => {
  const folders = [{ id: 'a', displayName: 'Inbox' }, { id: 'b', displayName: 'RunF9  Project' }, { id: 7, displayName: 'Broken' }, { displayName: 'No id' }]

  it('a folder name is trimmed, single-spaced and capped', () => {
    expect(cleanFolderName('  RunF9   Project \n')).toBe('RunF9 Project')
    expect(cleanFolderName(42)).toBe('')
    expect(cleanFolderName('x'.repeat(200))).toHaveLength(80)
  })

  it('the folder is found by name without regard to case or spacing', () => {
    expect(pickFolder(folders, 'runf9 project')).toEqual({ id: 'b', name: 'RunF9  Project' })
    expect(pickFolder(folders, 'INBOX')).toEqual({ id: 'a', name: 'Inbox' })
  })

  it('no folder is picked for an unknown or empty name, or a malformed entry', () => {
    expect(pickFolder(folders, 'Archive')).toBeNull()
    expect(pickFolder(folders, '   ')).toBeNull()
    expect(pickFolder(folders, 'Broken')).toBeNull()
    expect(pickFolder(folders, 'No id')).toBeNull()
  })

  it('messages are asked for from one folder, oldest first, after the cursor, one batch at a time', () => {
    const u = new URL(messagesUrl('https://graph.microsoft.com', 'AAMk/=id', '2026-11-01T10:00:00.000Z'))
    expect(u.pathname).toBe('/v1.0/me/mailFolders/AAMk%2F%3Did/messages')
    expect(u.searchParams.get('$filter')).toBe('receivedDateTime gt 2026-11-01T10:00:00.000Z')
    expect(u.searchParams.get('$orderby')).toBe('receivedDateTime asc')
    expect(u.searchParams.get('$top')).toBe(String(SYNC_BATCH))
    expect(u.searchParams.get('$select')).toBe('id,receivedDateTime')
  })
})
