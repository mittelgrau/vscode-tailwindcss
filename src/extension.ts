'use strict'

import * as vscode from 'vscode'
import { dirname } from 'path'
const htmlElements = require('./htmlElements.js')
const tailwindClassNames = require('tailwind-class-names')
const dlv = require('dlv')
const Color = require('color')

const CONFIG_GLOB =
  '**/{tailwind,tailwind.config,tailwind-config,.tailwindrc}.js'
const JS_TYPES = ['typescriptreact', 'javascript', 'javascriptreact']
const HTML_TYPES = [
  'html',
  'jade',
  'razor',
  'php',
  'blade',
  'twig',
  'markdown',
  'erb',
  'handlebars',
  'ejs',
  'nunjucks',
  'haml',
  'leaf',
  'liquid',
  'HTML (Eex)'
]
const CSS_TYPES = ['css', 'sass', 'scss', 'less', 'stylus']

export async function activate(context: vscode.ExtensionContext) {
  let tw

  try {
    tw = await getTailwind()
  } catch (err) {}

  let intellisense = new TailwindIntellisense(tw)
  context.subscriptions.push(intellisense)

  let watcher = vscode.workspace.createFileSystemWatcher(CONFIG_GLOB)

  watcher.onDidChange(onFileChange)
  watcher.onDidCreate(onFileChange)
  watcher.onDidDelete(onFileChange)

  async function onFileChange(event) {
    try {
      tw = await getTailwind()
    } catch (err) {
      intellisense.dispose()
      return
    }

    if (!tw) {
      intellisense.dispose()
      return
    }

    intellisense.reload(tw)
  }
}

async function getTailwind() {
  if (!vscode.workspace.name) return

  let files = await vscode.workspace.findFiles(
    CONFIG_GLOB,
    '**/node_modules/**',
    1
  )

  if (!files.length) return null

  let configPath = files[0].fsPath
  delete require.cache[configPath]

  let tailwindPackage = await vscode.workspace.findFiles(
    '**/node_modules/tailwindcss/package.json',
    null,
    1
  )

  if (!tailwindPackage.length) return null

  let pluginPath = dirname(tailwindPackage[0].fsPath)

  let tw

  try {
    tw = await tailwindClassNames({
      configPath,
      pluginPath,
      tree: true,
      strings: true
    })
  } catch (err) {
    return null
  }

  return tw
}

export function deactivate() {}

function createCompletionItemProvider({
  items,
  prefixedItems,
  languages,
  regex,
  triggerCharacters,
  config,
  enable = () => true,
  emmet = false
}: {
  items?
  prefixedItems?
  languages?: string[]
  regex?: RegExp
  triggerCharacters?: string[]
  config?
  prefix?: string
  enable?: (text: string) => boolean
  emmet?: boolean
} = {}): vscode.Disposable {
  return vscode.languages.registerCompletionItemProvider(
    languages,
    {
      provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position
      ): vscode.CompletionItem[] {
        const separator = config.options.separator || ':'
        let str

        const range: vscode.Range = new vscode.Range(
          new vscode.Position(0, 0),
          position
        )
        const text: string = document.getText(range)

        if (!enable(text)) return []

        let lines = text.split(/[\n\r]/)

        let matches = lines
          .slice(-5)
          .join('\n')
          .match(regex)

        if (matches) {
          let parts = matches[matches.length - 1].split(' ')
          str = parts[parts.length - 1]
        } else if (emmet) {
          // match emmet style syntax
          // e.g. .flex.items-center
          let currentLine = lines[lines.length - 1]
          let currentWord = currentLine.split(' ').pop()
          matches = currentWord.match(/^\.([^.()#>*^ \[\]=$@{}]*)$/)
          if (!matches) {
            matches = currentWord.match(
              new RegExp(
                `^([A-Z][a-zA-Z0-9]*|[a-z][a-z0-9]*-[a-z0-9-]+|${htmlElements
                  .map(x => `${x}\\b`)
                  .join('|')}).*?\\.([^.()#>*^ \\[\\]=$@{}]*)$`
              )
            )
          }
          if (matches) {
            let parts = matches[matches.length - 1].split('.')
            str = parts[parts.length - 1]
          }
        }

        if (typeof str !== 'undefined') {
          const pth = str
            .replace(new RegExp(`${separator}`, 'g'), '.')
            .replace(/\.$/, '')
            .replace(/^\./, '')
            .replace(/\./g, '.children.')

          if (pth !== '') {
            const itms =
              prefixedItems &&
              str.indexOf('.') === 0 &&
              str.indexOf(separator) === -1
                ? dlv(prefixedItems, pth)
                : dlv(items, pth)
            if (itms) {
              return Object.keys(itms.children).map(x => itms.children[x].item)
            }
          }

          if (str.indexOf(separator) === -1) {
            return prefixedItems && str.indexOf('.') === 0
              ? Object.keys(prefixedItems).map(x => prefixedItems[x].item)
              : Object.keys(items).map(x => items[x].item)
          }

          return []
        }

        return []
      }
    },
    ...triggerCharacters
  )
}

function createConfigItemProvider({
  languages,
  items,
  enable = () => true
}: {
  languages?: string[]
  items?: vscode.CompletionItem[]
  enable?: (text: string) => boolean
} = {}) {
  return vscode.languages.registerCompletionItemProvider(
    languages,
    {
      provideCompletionItems: (
        document: vscode.TextDocument,
        position: vscode.Position
      ): vscode.CompletionItem[] => {
        const range: vscode.Range = new vscode.Range(
          new vscode.Position(0, 0),
          position
        )
        const text: string = document.getText(range)

        if (!enable(text)) return []

        let lines = text.split(/[\n\r]/)

        let matches = lines
          .slice(-5)
          .join('\n')
          .match(/config\(["']([^"']*)$/)

        if (!matches) return []

        let objPath =
          matches[1]
            .replace(/\.[^.]*$/, '')
            .replace('.', '.children.')
            .trim() + '.children'
        let foo = dlv(items, objPath)

        if (foo) {
          return Object.keys(foo).map(x => foo[x].item)
        }

        return Object.keys(items).map(x => items[x].item)
      }
    },
    "'",
    '"',
    '.'
  )
}

function prefixItems(items, str, prefix) {
  const addPrefix =
    typeof prefix !== 'undefined' && prefix !== '' && str === prefix

  return Object.keys(items).map(x => {
    const item = items[x].item
    if (addPrefix) {
      item.filterText = item.insertText = `${prefix}${item.label}`
    } else {
      item.filterText = item.insertText = item.label
    }
    return item
  })
}

function depthOf(obj) {
  if (typeof obj !== 'object' || Array.isArray(obj)) return 0

  let level = 1

  for (let key in obj) {
    if (!obj.hasOwnProperty(key)) continue

    if (typeof obj[key] === 'object') {
      const depth = depthOf(obj[key]) + 1
      level = Math.max(depth, level)
    }
  }

  return level
}

function createItems(classNames, separator, config, prefix = '', parent = '') {
  let items = {}
  let i = 0

  Object.keys(classNames).forEach(key => {
    if (depthOf(classNames[key]) === 0) {
      const item = new vscode.CompletionItem(
        key,
        vscode.CompletionItemKind.Constant
      )
      item.filterText = item.insertText = `${prefix}${key}`
      item.sortText = naturalExpand(i.toString())
      if (key !== 'container' && key !== 'group') {
        if (parent) {
          item.detail = classNames[key].replace(
            new RegExp(`:${parent} \{(.*?)\}`),
            '$1'
          )
        } else {
          item.detail = classNames[key]
        }

        let color = getColorFromDecl(item.detail)
        if (color) {
          item.kind = vscode.CompletionItemKind.Color
          item.documentation = color
        }
      }
      items[key] = {
        item
      }
      i++
    } else {
      const item = new vscode.CompletionItem(
        `${key}${separator}`,
        vscode.CompletionItemKind.Constant
      )
      item.filterText = item.insertText = `${prefix}${key}${separator}`
      item.sortText = naturalExpand(i.toString())
      item.command = { title: '', command: 'editor.action.triggerSuggest' }
      if (key === 'hover' || key === 'focus' || key === 'active') {
        item.detail = `:${key}`
        item.sortText = `a${item.sortText}`
      } else if (key === 'group-hover') {
        item.detail = '.group:hover &'
        item.sortText = `a${item.sortText}`
      } else if (
        config.screens &&
        Object.keys(config.screens).indexOf(key) !== -1
      ) {
        item.detail = `@media (min-width: ${config.screens[key]})`
        item.sortText = `m${item.sortText}`
      }
      items[key] = {
        item,
        children: createItems(classNames[key], separator, config, prefix, key)
      }
      i++
    }
  })

  return items
}

function createConfigItems(config, prefix = '') {
  let items = {}
  let i = 0

  Object.keys(config).forEach(key => {
    let item = new vscode.CompletionItem(
      key,
      vscode.CompletionItemKind.Constant
    )

    if (depthOf(config[key]) === 0) {
      if (key === 'plugins') return

      item.filterText = item.insertText = `${prefix}${key}`
      item.sortText = naturalExpand(i.toString())
      if (typeof config[key] === 'string' || typeof config[key] === 'number') {
        item.detail = config[key].toString()

        let color = getColorFromValue(item.detail)
        if (color) {
          item.kind = vscode.CompletionItemKind.Color
          item.documentation = color
        }
      } else if (Array.isArray(config[key])) {
        item.detail = stringifyArray(config[key])
      }
      items[key] = { item }
    } else {
      if (key === 'modules' || key === 'options') return

      item.filterText = item.insertText = `${key}.`
      item.sortText = naturalExpand(i.toString())
      item.command = { title: '', command: 'editor.action.triggerSuggest' }
      items[key] = { item, children: createConfigItems(config[key], prefix) }
    }

    i++
  })

  return items
}

class TailwindIntellisense {
  private _providers: vscode.Disposable[]
  private _disposable: vscode.Disposable
  private _tailwind
  private _items
  private _prefixedItems
  private _configItems
  private _prefixedConfigItems

  constructor(tailwind) {
    if (tailwind) {
      this._tailwind = tailwind
      this.reload(tailwind)
    }
  }

  public reload(tailwind) {
    this.dispose()

    const separator = dlv(tailwind.config, 'options.separator', ':')

    if (separator !== ':') return

    this._items = createItems(tailwind.classNames, separator, tailwind.config)
    this._prefixedItems = createItems(
      tailwind.classNames,
      separator,
      tailwind.config,
      '.'
    )
    this._configItems = createConfigItems(tailwind.config)
    this._prefixedConfigItems = createConfigItems(tailwind.config, '.')

    this._providers = []

    this._providers.push(
      createCompletionItemProvider({
        items: this._items,
        languages: JS_TYPES,
        regex: /\btw`([^`]*)$/,
        triggerCharacters: ['`', ' ', separator],
        config: tailwind.config
      })
    )

    this._providers.push(
      createCompletionItemProvider({
        items: this._items,
        prefixedItems: this._prefixedItems,
        languages: CSS_TYPES,
        regex: /@apply ([^;}]*)$/,
        triggerCharacters: ['.', separator],
        config: tailwind.config
      })
    )
    this._providers.push(
      createCompletionItemProvider({
        items: this._items,
        prefixedItems: this._items,
        languages: ['postcss'],
        regex: /@apply ([^;}]*)$/,
        triggerCharacters: ['.', separator],
        config: tailwind.config
      })
    )

    this._providers.push(
      createCompletionItemProvider({
        items: this._items,
        languages: HTML_TYPES,
        regex: /\bclass=["']([^"']*)$/, // /\bclass(Name)?=(["'])(?!.*?\2)/
        triggerCharacters: ["'", '"', ' ', '.', separator],
        config: tailwind.config,
        emmet: true
      })
    )

    this._providers.push(
      createCompletionItemProvider({
        items: this._items,
        languages: JS_TYPES,
        regex: /\bclass(Name)?=["']([^"']*)$/, // /\bclass(Name)?=(["'])(?!.*?\2)/
        triggerCharacters: ["'", '"', ' ', separator]
          .concat([
            Object.keys(
              vscode.workspace.getConfiguration('emmet.includeLanguages')
            ).indexOf('javascript') !== -1 && '.'
          ])
          .filter(Boolean),
        config: tailwind.config,
        emmet:
          Object.keys(
            vscode.workspace.getConfiguration('emmet.includeLanguages')
          ).indexOf('javascript') !== -1
      })
    )

    // Vue.js
    this._providers.push(
      createCompletionItemProvider({
        items: this._items,
        languages: ['vue'],
        regex: /\bclass=["']([^"']*)$/,
        enable: isWithinTemplate,
        triggerCharacters: ["'", '"', ' ', separator]
          .concat([
            Object.keys(
              vscode.workspace.getConfiguration('emmet.includeLanguages')
            ).indexOf('vue-html') !== -1 && '.'
          ])
          .filter(Boolean),
        config: tailwind.config,
        emmet:
          Object.keys(
            vscode.workspace.getConfiguration('emmet.includeLanguages')
          ).indexOf('vue-html') !== -1
      })
    )
    this._providers.push(
      createCompletionItemProvider({
        items: this._items,
        languages: ['vue'],
        regex: /\bclass=["']([^"']*)$/,
        enable: text => {
          if (
            text.indexOf('<script') !== -1 &&
            text.indexOf('</script>') === -1
          ) {
            return true
          }
          return false
        },
        triggerCharacters: ["'", '"', ' ', separator],
        config: tailwind.config
      })
    )
    this._providers.push(
      createCompletionItemProvider({
        items: this._items,
        languages: ['vue'],
        regex: /@apply ([^;}]*)$/,
        triggerCharacters: ['.', separator],
        config: tailwind.config,
        enable: text => {
          if (
            text.indexOf('<style') !== -1 &&
            text.indexOf('</style>') === -1
          ) {
            return true
          }
          return false
        }
      })
    )

    this._providers.push(
      createConfigItemProvider({
        languages: CSS_TYPES,
        items: this._prefixedConfigItems
      })
    )
    this._providers.push(
      createConfigItemProvider({
        languages: ['postcss'],
        items: this._configItems
      })
    )

    this._providers.push(
      createConfigItemProvider({
        languages: ['vue'],
        items: this._configItems,
        enable: text => {
          if (
            text.indexOf('<style') !== -1 &&
            text.indexOf('</style>') === -1
          ) {
            return true
          }
          return false
        }
      })
    )

    this._providers.push(
      vscode.languages.registerHoverProvider(
        [...HTML_TYPES, ...JS_TYPES, 'vue'],
        {
          provideHover: (document, position, token) => {
            const range1: vscode.Range = new vscode.Range(
              new vscode.Position(Math.max(position.line - 5, 0), 0),
              position
            )
            const text1: string = document.getText(range1)

            if (!/\bclass(Name)?=['"][^'"]*$/.test(text1)) return

            const range2: vscode.Range = new vscode.Range(
              new vscode.Position(Math.max(position.line - 5, 0), 0),
              position.with({ line: position.line + 1 })
            )
            const text2: string = document.getText(range2)

            let str = text1 + text2.substr(text1.length).match(/^([^"' ]*)/)[0]
            let matches = str.match(/\bclass(Name)?=["']([^"']*)$/)

            if (matches && matches[2]) {
              let className = matches[2].split(' ').pop()
              let parts = className.split(':')

              if (typeof dlv(this._tailwind.classNames, parts) === 'string') {
                let base = parts.pop()
                let selector = `.${escapeClassName(className)}`

                if (parts.indexOf('hover') !== -1) {
                  selector += ':hover'
                } else if (parts.indexOf('focus') !== -1) {
                  selector += ':focus'
                } else if (parts.indexOf('active') !== -1) {
                  selector += ':active'
                } else if (parts.indexOf('group-hover') !== -1) {
                  selector = `.group:hover ${selector}`
                }

                let hoverStr = new vscode.MarkdownString()
                let css = this._tailwind.classNames[base]
                let m = css.match(/^(::?[a-z-]+) {(.*?)}/)
                if (m) {
                  selector += m[1]
                  css = m[2].trim()
                }
                css = css.replace(/([;{]) /g, '$1\n').replace(/^/gm, '  ')
                let code = `${selector} {\n${css}\n}`
                let screens = dlv(this._tailwind.config, 'screens', {})

                Object.keys(screens).some(screen => {
                  if (parts.indexOf(screen) !== -1) {
                    code = `@media (min-width: ${
                      screens[screen]
                    }) {\n${code.replace(/^/gm, '  ')}\n}`
                    return true
                  }
                  return false
                })
                hoverStr.appendCodeblock(code, 'css')

                let hoverRange = new vscode.Range(
                  new vscode.Position(
                    position.line,
                    position.character +
                      str.length -
                      text1.length -
                      className.length
                  ),
                  new vscode.Position(
                    position.line,
                    position.character + str.length - text1.length
                  )
                )

                return new vscode.Hover(hoverStr, hoverRange)
              }
            }

            return null
          }
        }
      )
    )

    // @screen
    this._providers.push(
      createScreenCompletionItemProvider({
        config: tailwind.config,
        languages: [...CSS_TYPES, 'postcss', 'vue']
      })
    )

    this._disposable = vscode.Disposable.from(...this._providers)
  }

  dispose() {
    if (this._disposable) {
      this._disposable.dispose()
    }
  }
}

function pad(n) {
  return ('00000000' + n).substr(-8)
}

function naturalExpand(a: string) {
  return a.replace(/\d+/g, pad)
}

function stringifyArray(arr: Array<any>): string {
  return arr
    .reduce((acc, curr) => {
      let str = curr.toString()
      if (str.includes(' ')) {
        acc.push(`"${str.replace(/\s\s+/g, ' ')}"`)
      } else {
        acc.push(str)
      }
      return acc
    }, [])
    .join(', ')
}

function escapeClassName(className) {
  return className.replace(/([^A-Za-z0-9\-])/g, '\\$1')
}

function getColorFromDecl(cssStr: string) {
  let matches = cssStr.match(/: ([^;]+);/g)
  if (matches === null || matches.length > 1) return

  let color = matches[0].slice(2, -1).trim()

  return getColorFromValue(color)
}

function getColorFromValue(value: string) {
  if (value === 'transparent') {
    return 'rgba(0, 0, 0, 0.01)'
  }

  try {
    let parsed = Color(value)
    if (parsed.valpha === 0) return 'rgba(0, 0, 0, 0.01)'
    return parsed.rgb().string()
  } catch (err) {
    return
  }
}

function createScreenCompletionItemProvider({
  languages,
  config
}): vscode.Disposable {
  return vscode.languages.registerCompletionItemProvider(
    languages,
    {
      provideCompletionItems: (
        document: vscode.TextDocument,
        position: vscode.Position
      ): vscode.CompletionItem[] => {
        let range: vscode.Range = new vscode.Range(
          new vscode.Position(0, 0),
          position
        )
        let text: string = document.getText(range)

        if (
          document.languageId === 'vue' &&
          !(text.indexOf('<style') !== -1 && text.indexOf('</style>') === -1)
        )
          return []

        let line = text.split(/[\n\r]/).pop()

        if (/@screen $/.test(line)) {
          return Object.keys(dlv(config, 'screens', {})).map((screen, i) => {
            let item = new vscode.CompletionItem(
              screen,
              vscode.CompletionItemKind.Constant
            )
            item.insertText = new vscode.SnippetString(`${screen} {\n\t$0\n}`)
            item.detail =
              typeof config.screens[screen] === 'string'
                ? config.screens[screen]
                : ''
            item.sortText = naturalExpand(i.toString())
            return item
          })
        }

        return []
      }
    },
    ' '
  )
}

function isWithinTemplate(text: string) {
  let regex = /(<\/?template\b)/g
  let match
  let d = 0
  while ((match = regex.exec(text)) !== null) {
    d += match[0] === '</template' ? -1 : 1
  }
  return d !== 0
}
