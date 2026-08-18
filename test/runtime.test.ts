import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'

// runtime.ts é CJS (`module.exports`) e roda no host via type stripping;
// o TS o enxerga como "script", então o teste o carrega com require nativo
// (createRequire) — exatamente como o Node Core do host faz.
const require = createRequire(import.meta.url)
const runtime = require('../runtime.ts') as {
  __internals: {
    normalizeAccents: (str: unknown) => string
    buildVocabulary: (items: Array<{ name: string }>) => Set<string>
    filterQueryWords: (qWords: string[], vocab: Set<string>) => string[]
    scoreNameMatch: (nameNorm: string, q: string, vocab: Set<string>) => number
    extractSearchTerms: (raw: unknown) => string
    inferCategory: (name: string, dirPath: string) => string
    isFolderQuery: (query: string) => boolean
    isFileQuery: (query: string) => boolean
    isExplicitOpenQuery: (query: string) => boolean
  }
}

const {
  normalizeAccents,
  buildVocabulary,
  filterQueryWords,
  scoreNameMatch,
  extractSearchTerms,
  inferCategory,
  isFolderQuery,
  isFileQuery,
  isExplicitOpenQuery,
} = runtime.__internals

describe('normalizeAccents', () => {
  it('lowercases and strips combining marks', () => {
    expect(normalizeAccents('Café Émotion Ção')).toBe('cafe emotion cao')
  })

  it('handles falsy input', () => {
    expect(normalizeAccents(null)).toBe('')
    expect(normalizeAccents(undefined)).toBe('')
  })

  it('does not trim whitespace', () => {
    expect(normalizeAccents('  X  ')).toBe('  x  ')
  })
})

describe('buildVocabulary', () => {
  it('splits names on space/underscore/dash, normalizes, keeps words with 2+ chars', () => {
    const vocab = buildVocabulary([
      { name: 'Visual Studio Code' },
      { name: 'Google_Chrome' },
      { name: 'A B' },
      { name: 'Café' },
    ])
    expect(vocab).toBeInstanceOf(Set)
    expect(vocab.size).toBe(6)
    for (const w of ['visual', 'studio', 'code', 'google', 'chrome', 'cafe']) {
      expect(vocab.has(w)).toBe(true)
    }
    expect(vocab.has('a')).toBe(false)
    expect(vocab.has('b')).toBe(false)
  })

  it('returns an empty set for empty items', () => {
    expect(buildVocabulary([]).size).toBe(0)
  })
})

describe('filterQueryWords', () => {
  const vocab = new Set(['chrome', 'visual', 'studio', 'code'])

  it('keeps words present in the vocabulary', () => {
    expect(filterQueryWords(['chrome', 'studio'], vocab)).toEqual(['chrome', 'studio'])
  })

  it('keeps words that are prefixes of vocabulary words', () => {
    expect(filterQueryWords(['chrom'], vocab)).toEqual(['chrom'])
    expect(filterQueryWords(['visu'], vocab)).toEqual(['visu'])
  })

  it('drops words that are neither in the vocabulary nor a prefix', () => {
    expect(filterQueryWords(['zzz'], vocab)).toEqual([])
    expect(filterQueryWords(['chrome', 'zzz'], vocab)).toEqual(['chrome'])
  })

  it('drops single-character words', () => {
    expect(filterQueryWords(['a', 'chrome'], vocab)).toEqual(['chrome'])
  })
})

describe('scoreNameMatch', () => {
  const vocab = new Set(['chrome', 'visual', 'studio', 'code'])

  it('exact match returns 1.0', () => {
    expect(scoreNameMatch('chrome', 'chrome', vocab)).toBe(1.0)
  })

  it('clean exact match after filtering out unknown words returns 1.0', () => {
    expect(scoreNameMatch('chrome', 'chrome zzq', vocab)).toBe(1.0)
  })

  it('prefix match scores between 0.9 and 1.0', () => {
    const s = scoreNameMatch('chrome', 'chro', vocab)
    expect(s).toBeGreaterThanOrEqual(0.9)
    expect(s).toBeLessThan(1.0)
    expect(s).toBeCloseTo(0.9 + (4 / 6) * 0.05, 5)
  })

  it('contains match scores between 0.7 and 0.9', () => {
    expect(scoreNameMatch('google chrome', 'chrome', vocab)).toBeCloseTo(0.7 + (6 / 13) * 0.15, 5)
  })

  it('word-by-word fuzzy match scores', () => {
    expect(scoreNameMatch('visual studio code', 'visual code', vocab)).toBeCloseTo(0.3 + (2 / 2) * 0.4, 5)
  })

  it('character-level fuzzy match for short queries', () => {
    expect(scoreNameMatch('abcxyz', 'axc', new Set())).toBeCloseTo(0.15 + (3 / 3) * 0.25, 5)
  })

  it('no match returns 0', () => {
    expect(scoreNameMatch('alpha', 'omega', new Set())).toBe(0)
  })
})

describe('extractSearchTerms', () => {
  it('removes opening verbs and stopwords', () => {
    expect(extractSearchTerms('abra o chrome')).toBe('chrome')
    expect(extractSearchTerms('abra a pasta dev')).toBe('dev')
    expect(extractSearchTerms('open spotify')).toBe('spotify')
    expect(extractSearchTerms('busque o relatorio')).toBe('relatorio')
  })

  it('keeps plain queries unchanged', () => {
    expect(extractSearchTerms('chrome')).toBe('chrome')
    expect(extractSearchTerms('visual studio')).toBe('visual studio')
  })

  it('returns the raw query when every term is stripped', () => {
    expect(extractSearchTerms('abra o app')).toBe('abra o app')
    expect(extractSearchTerms('')).toBe('')
  })
})

describe('inferCategory', () => {
  it('classifies browsers', () => {
    expect(inferCategory('Google Chrome', '')).toBe('Navegador')
    expect(inferCategory('Firefox', '')).toBe('Navegador')
  })

  it('classifies development tools', () => {
    expect(inferCategory('Visual Studio Code', '')).toBe('Desenvolvimento')
  })

  it('classifies media and communication', () => {
    expect(inferCategory('Spotify', '')).toBe('Midia')
    expect(inferCategory('Discord', '')).toBe('Comunicacao')
  })

  it('uses directory hints', () => {
    expect(inferCategory('Calculator', 'C:\\Windows\\System32')).toBe('Sistema')
    expect(inferCategory('anything', 'C:\\Games')).toBe('Jogos')
  })

  it('defaults to Outros', () => {
    expect(inferCategory('mystery-tool', 'C:\\Somewhere')).toBe('Outros')
    expect(inferCategory('', '')).toBe('Outros')
  })
})

describe('query classifiers', () => {
  it('isFolderQuery detects folder intents', () => {
    expect(isFolderQuery('abra a pasta dev')).toBe(true)
    expect(isFolderQuery('onde esta a pasta Downloads')).toBe(true)
    expect(isFolderQuery('abrir diretório de projetos')).toBe(true)
    expect(isFolderQuery('chrome')).toBe(false)
  })

  it('isFileQuery detects file intents', () => {
    expect(isFileQuery('procure o pdf')).toBe(true)
    expect(isFileQuery('abra o arquivo relatorio')).toBe(true)
    expect(isFileQuery('chrome')).toBe(false)
  })

  it('isExplicitOpenQuery detects explicit open verbs', () => {
    expect(isExplicitOpenQuery('abra o chrome')).toBe(true)
    expect(isExplicitOpenQuery('abrir spotify')).toBe(true)
    expect(isExplicitOpenQuery('open file')).toBe(true)
    expect(isExplicitOpenQuery('busque o chrome')).toBe(false)
    expect(isExplicitOpenQuery('openai')).toBe(false)
    expect(isExplicitOpenQuery('')).toBe(false)
  })
})
