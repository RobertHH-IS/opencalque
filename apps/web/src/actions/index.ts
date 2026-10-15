/*
 * What the commands, menus and panels do, by subject. Every user-triggerable action is a command
 * (`commands.ts`) calling one of these.
 *
 *   file       drawings and files: open, save, export, import
 *   clipboard  cut, copy, paste
 *   edit       the selection and pages: delete, duplicate, transform, group, components, order, align, style
 *   walls      the selected walls: dimension, split, extend, trim
 *   view       zoom, and the view kept while what is on every sheet is edited
 */
export * from './clipboard'
export { guarded } from './common'
export * from './edit'
export * from './file'
export * from './view'
export * from './walls'
