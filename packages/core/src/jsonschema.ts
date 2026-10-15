import * as z from 'zod'
import { DeclarativeExtensionSchema } from './declarative'
import { OpSchema } from './ops'
import { DocumentSchema, NodeSchema } from './schema'

/** JSON Schemas generated from the Zod definitions, for tools that validate or describe the format. */
export const documentJsonSchema = () => z.toJSONSchema(DocumentSchema)
export const nodeJsonSchema = () => z.toJSONSchema(NodeSchema)
export const opsJsonSchema = () => z.toJSONSchema(z.array(OpSchema))
/** An extension written as data (`declarative.ts`), as a file of the warehouse or a catalog holds it. */
export const extensionJsonSchema = () => z.toJSONSchema(DeclarativeExtensionSchema)
