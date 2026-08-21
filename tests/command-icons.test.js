// @vitest-environment jsdom

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, test } from 'vitest'

import {
  COMMAND_ICON_METADATA,
  COMMAND_ICON_NAMES,
  COMMAND_ICON_SHEET,
  getCommandIconMetadata,
  hasCommandIcon,
  normalizeCommandIconName,
} from '../src/js/CommandIcons.js'
import commands from '../src/js/commands/_commands.js'

const projectPath = (...parts) => join(process.cwd(), ...parts)

describe('Nanquim command icon registry', () => {
  test('provides one unique 24px mask cell for every registered command', () => {
    const commandNames = Object.keys(commands)

    expect([...COMMAND_ICON_NAMES].sort()).toEqual([...commandNames].sort())
    expect(COMMAND_ICON_SHEET).toEqual({
      url: '/assets/img/nanquim-command-icons.svg',
      maskImage: "url('/assets/img/nanquim-command-icons.svg')",
      columns: 8,
      rows: 4,
      cellSize: 24,
      width: 192,
      height: 96,
      maskSize: '800% 400%',
    })

    const occupiedCells = new Set()
    commandNames.forEach((command) => {
      const metadata = getCommandIconMetadata(command)
      expect(metadata, command).not.toBeNull()
      expect(metadata.command, command).toBe(command)
      expect(metadata.id, command).toBe(`command-${command.toLowerCase().replace(/_/g, '-')}`)
      expect(metadata.column, command).toBeGreaterThanOrEqual(0)
      expect(metadata.column, command).toBeLessThan(COMMAND_ICON_SHEET.columns)
      expect(metadata.row, command).toBeGreaterThanOrEqual(0)
      expect(metadata.row, command).toBeLessThan(COMMAND_ICON_SHEET.rows)
      expect(metadata.positionX, command).toMatch(/^-?\d+(?:\.\d+)?%$/)
      expect(metadata.positionY, command).toMatch(/^-?\d+(?:\.\d+)?%$/)
      occupiedCells.add(`${metadata.column},${metadata.row}`)
    })

    expect(occupiedCells.size).toBe(commandNames.length)
  })

  test('normalizes display variants without inventing unknown icons', () => {
    expect(normalizeCommandIconName(' match-properties ')).toBe('MATCH_PROPERTIES')
    expect(hasCommandIcon('match properties')).toBe(true)
    expect(getCommandIconMetadata('match-properties')).toBe(COMMAND_ICON_METADATA.MATCH_PROPERTIES)
    expect(hasCommandIcon('not a command')).toBe(false)
    expect(getCommandIconMetadata('not a command')).toBeNull()
  })
})

describe('Nanquim command icon sheet', () => {
  test('is a valid, self-contained 8x4 SVG with the registered icon ids', async () => {
    const source = await readFile(
      projectPath('public', 'assets', 'img', 'nanquim-command-icons.svg'),
      'utf8',
    )
    const document = new DOMParser().parseFromString(source, 'image/svg+xml')
    const root = document.documentElement
    const iconGroups = [...document.querySelectorAll('g[id^="command-"]')]
    const iconIds = iconGroups.map((element) => element.id)
    const expectedIds = Object.values(COMMAND_ICON_METADATA).map(({ id }) => id)

    expect(document.querySelector('parsererror')).toBeNull()
    expect(root.getAttribute('viewBox')).toBe('0 0 192 96')
    expect(root.getAttribute('width')).toBe('192')
    expect(root.getAttribute('height')).toBe('96')
    expect(document.querySelector('title')?.textContent).toBe('Nanquim command icon mask sheet')
    expect(new Set(iconIds).size).toBe(iconIds.length)
    expect(iconIds.sort()).toEqual(expectedIds.sort())
    expect(document.querySelector('image, use, text, style, script, foreignObject')).toBeNull()
    expect(source).not.toMatch(/(?:href|src)\s*=/i)

    Object.values(COMMAND_ICON_METADATA).forEach((metadata) => {
      const group = document.getElementById(metadata.id)
      expect(group, metadata.command).not.toBeNull()
      expect(group.getAttribute('transform'), metadata.command).toBe(
        `translate(${metadata.column * COMMAND_ICON_SHEET.cellSize} ${metadata.row * COMMAND_ICON_SHEET.cellSize})`,
      )
      expect(group.querySelector('path, line, rect, circle, ellipse, polyline, polygon'), metadata.command)
        .not.toBeNull()
    })
  })

  test('uses the project technical-ink mask grammar', async () => {
    const source = await readFile(
      projectPath('public', 'assets', 'img', 'nanquim-command-icons.svg'),
      'utf8',
    )

    expect(source).toContain('fill="none"')
    expect(source).toContain('stroke="#fff"')
    expect(source).toContain('stroke-width="1.75"')
    expect(source).toContain('stroke-linecap="round"')
    expect(source).toContain('stroke-linejoin="round"')
    const colors = [...source.matchAll(/#[0-9a-f]{3,8}/gi)].map((match) => match[0].toLowerCase())
    expect(new Set(colors)).toEqual(new Set(['#fff']))
  })
})
