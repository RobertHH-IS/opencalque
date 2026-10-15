import { describe, expect, it } from 'vitest'
import { tabsInView } from './dock'

describe('tabsInView', () => {
  it('shows every tab when they all fit, the button taking no room', () => {
    expect(tabsInView([80, 70, 90], 0, 240, 30)).toEqual([true, true, true])
  })

  it('shows the first ones that fit beside the button, and leaves out the rest', () => {
    // 80 + 70 = 150 fits in 240 - 30; a third of 90 would not.
    expect(tabsInView([80, 70, 90, 60], 0, 240, 30)).toEqual([true, true, false, false])
  })

  it('always shows the tab in front, in its place, giving up the last ones before it', () => {
    expect(tabsInView([80, 70, 90, 60], 3, 240, 30)).toEqual([true, true, false, true])
    expect(tabsInView([80, 70, 90, 60], 2, 240, 30)).toEqual([true, false, true, false])
  })

  it('keeps the order: a short tab after one that did not fit is left out too', () => {
    expect(tabsInView([80, 120, 20], 0, 200, 30)).toEqual([true, false, false])
  })

  it('shows the tab in front alone when there is room for no other', () => {
    expect(tabsInView([80, 70, 90], 1, 60, 30)).toEqual([false, true, false])
  })

  it('takes half a pixel too many for rounding', () => {
    expect(tabsInView([80.3, 70.2], 0, 150, 30)).toEqual([true, true])
  })
})
