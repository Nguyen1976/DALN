/**
 * The part of a multipart upload our controllers read.
 *
 * Multer hands over a much larger object (`Express.Multer.File`), but that
 * type only exists as an ambient global from `@types/multer`: an editor whose
 * TypeScript server has not re-read `node_modules` reports it as missing, and
 * the field names are all we ever touch. Naming them here keeps the
 * controllers typed without depending on that global.
 */
export interface MultipartFile {
  /** The file's bytes, held in memory by Multer's default storage. */
  buffer: Buffer
  /** The name of the file on the uploader's machine. */
  originalname: string
}
