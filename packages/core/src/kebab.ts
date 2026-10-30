// Browser-safe: the typed client builds default paths with it.
/**
 * The URL segment for a declared name: `orderBilling` becomes `order-billing`,
 * `importCSV` becomes `import-csv`. Dots and existing dashes stay.
 */
export function kebabCase(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
    .toLowerCase();
}
