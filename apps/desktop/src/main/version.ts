/** The numbers of a version and the parts of its pre-release label: 1.2.0-rc.1 is [1, 2, 0] and ['rc', '1']. */
function parts(version: string): [number[], string[]] {
  const [core, ...label] = version.trim().replace(/^v/, '').split('+')[0].split('-')
  const numbers = core.split('.').map(Number)
  return [[0, 1, 2].map((i) => numbers[i] || 0), label.length > 0 ? label.join('-').split('.') : []]
}

/**
 * Whether version `a` comes after version `b`, as semantic versioning orders them: by their
 * numbers, then a version comes after its own pre-releases (1.1.0 after 1.1.0-rc.2), and
 * pre-releases by their labels, part by part, numbers as numbers.
 */
export function isNewer(a: string, b: string): boolean {
  const [numbersA, labelA] = parts(a)
  const [numbersB, labelB] = parts(b)
  for (let i = 0; i < 3; i++) if (numbersA[i] !== numbersB[i]) return numbersA[i] > numbersB[i]
  if (labelA.length === 0 || labelB.length === 0) return labelA.length === 0 && labelB.length > 0
  for (let i = 0; i < Math.max(labelA.length, labelB.length); i++) {
    // A label that is the start of the other comes first.
    if (i >= labelA.length) return false
    if (i >= labelB.length) return true
    const [x, y] = [labelA[i], labelB[i]]
    if (x === y) continue
    const [numberX, numberY] = [/^\d+$/.test(x), /^\d+$/.test(y)]
    if (numberX && numberY) return Number(x) > Number(y)
    // A number comes before a word.
    if (numberX !== numberY) return numberY
    return x > y
  }
  return false
}
