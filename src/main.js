import './styles/main.sass'
import './js/libs/svg.js/svg.select.css'

import { Editor } from './js/Editor'
import { Navbar } from './js/Navbar'
import { Viewport } from './js/Viewport'
import { Outliner } from './js/Outliner'
import { Properties } from './js/Properties'
import { Terminal } from './js/Terminal'
import { StatusBar } from './js/StatusBar'

const editor = new Editor()
const navbar = new Navbar(editor)
const viewport = new Viewport(editor)
const outliner = new Outliner(editor)
const properties = new Properties(editor)
const terminal = new Terminal(editor)
const statusbar = new StatusBar(editor)

window.editor = editor
