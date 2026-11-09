import { describe, expect, it } from 'vitest'
import {
  readStudioPreferences,
  readStudioSnapshot,
  studioPreferencesStorageKey,
  studioSnapshotStorageKey,
  writeStudioPreferences,
  writeStudioSnapshot,
} from '../imageStudioPersistence'

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>()

  get length() {
    return this.values.size
  }

  clear() {
    this.values.clear()
  }

  getItem(key: string) {
    return this.values.get(key) ?? null
  }

  key(index: number) {
    return Array.from(this.values.keys())[index] ?? null
  }

  removeItem(key: string) {
    this.values.delete(key)
  }

  setItem(key: string, value: string) {
    this.values.set(key, value)
  }
}

describe('image studio persistence', () => {
  it('scopes preference keys to the current user', () => {
    expect(studioPreferencesStorageKey(7)).toBe(
      'sub2api:image-studio:preferences:7',
    )
  })

  it('merges preference updates without dropping existing values', () => {
    const storage = new MemoryStorage()
    storage.setItem(studioPreferencesStorageKey(7), JSON.stringify({
      keyId: 'key-1',
      model: 'gpt-image-1',
    }))

    writeStudioPreferences(storage, 7, { model: 'gpt-image-2' })

    expect(readStudioPreferences(storage, 7)).toEqual({
      keyId: 'key-1',
      model: 'gpt-image-2',
    })
  })

  it('returns empty preferences for malformed data', () => {
    const storage = new MemoryStorage()
    storage.setItem(studioPreferencesStorageKey(7), '{invalid')
    expect(readStudioPreferences(storage, 7)).toEqual({
      keyId: '',
      model: '',
    })
  })

  it('removes the legacy unscoped snapshot before reading a user snapshot', () => {
    const storage = new MemoryStorage()
    storage.setItem('sub2api:image-studio:snapshot-v1', JSON.stringify({
      images: [{ id: 'legacy' }],
    }))

    expect(readStudioSnapshot(storage, 7)).toBeNull()
    expect(storage.getItem('sub2api:image-studio:snapshot-v1')).toBeNull()
  })

  it('validates snapshot fields and writes only the user-scoped key', () => {
    const storage = new MemoryStorage()
    const snapshot = {
      keys: [{ id: 1, name: 'key', key: 'secret' }],
      selectedKeyId: '1',
      imageModels: ['gpt-image-1', 7],
      imageModel: 'gpt-image-1',
      images: [{ id: 'local-1' }],
    }

    writeStudioSnapshot(storage, 7, snapshot as any)

    expect(storage.getItem('sub2api:image-studio:snapshot-v1:7')).not.toBeNull()
    expect(readStudioSnapshot(storage, 7)).toEqual({
      keys: [{ id: 1, name: 'key', key: 'secret' }],
      selectedKeyId: '1',
      imageModels: ['gpt-image-1'],
      imageModel: 'gpt-image-1',
      images: [{ id: 'local-1' }],
    })
    expect(studioSnapshotStorageKey(7)).toBe(
      'sub2api:image-studio:snapshot-v1:7',
    )
  })
})
