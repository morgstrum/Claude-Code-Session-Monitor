// Generates build/icon.{icns,ico,png} from resources/icon.png (see resources/icon.svg).
// Run after changing the icon: node scripts/make-icons.mjs
import png2icons from 'png2icons'
import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const input = readFileSync(join(root, 'resources/icon.png'))
mkdirSync(join(root, 'build'), { recursive: true })

const icns = png2icons.createICNS(input, png2icons.BICUBIC, 0)
const ico = png2icons.createICO(input, png2icons.BICUBIC, 0, false)
if (!icns || !ico) throw new Error('icon conversion failed')

writeFileSync(join(root, 'build/icon.icns'), icns)
writeFileSync(join(root, 'build/icon.ico'), ico)
writeFileSync(join(root, 'build/icon.png'), input)
console.log('wrote build/icon.icns, build/icon.ico, build/icon.png')
