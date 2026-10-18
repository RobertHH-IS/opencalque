import { expect, test } from 'vitest'
import { isNewer } from './version'

test('a version is newer by its numbers, in order', () => {
  expect(isNewer('1.0.1', '1.0.0')).toBe(true)
  expect(isNewer('1.1.0', '1.0.9')).toBe(true)
  expect(isNewer('2.0.0', '1.12.3')).toBe(true)
  expect(isNewer('1.10.0', '1.9.0')).toBe(true)
  expect(isNewer('1.0.0', '1.0.0')).toBe(false)
  expect(isNewer('1.0.0', '1.0.1')).toBe(false)
  expect(isNewer('v1.2.0', '1.1.0')).toBe(true)
})

test('a version comes after its pre-releases, which are ordered by their labels', () => {
  expect(isNewer('1.1.0', '1.1.0-rc.2')).toBe(true)
  expect(isNewer('1.1.0-rc.2', '1.1.0')).toBe(false)
  expect(isNewer('1.1.0-rc.1', '1.0.0')).toBe(true)
  expect(isNewer('1.1.0-rc.10', '1.1.0-rc.9')).toBe(true)
  expect(isNewer('1.1.0-rc.1', '1.1.0-beta.3')).toBe(true)
  expect(isNewer('1.1.0-rc.1', '1.1.0-rc')).toBe(true)
  expect(isNewer('1.1.0-rc', '1.1.0-rc.1')).toBe(false)
  expect(isNewer('1.1.0-rc.a', '1.1.0-rc.1')).toBe(true)
  expect(isNewer('1.1.0-rc.1', '1.1.0-rc.1')).toBe(false)
})
