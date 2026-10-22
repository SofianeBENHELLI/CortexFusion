import { validateCatalog, type Catalog } from "./catalog";
const database = "cortexfusion.local-catalog";
function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(database, 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("catalogs");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}
export async function readCatalog(): Promise<Catalog | null> {
  const db = await open();
  try {
    const value = await new Promise<unknown>((resolve, reject) => {
      const request = db
        .transaction("catalogs")
        .objectStore("catalogs")
        .get("current");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return value ? validateCatalog(value) : null;
  } finally {
    db.close();
  }
}
export async function storeCatalog(catalog: Catalog | null): Promise<void> {
  const db = await open();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("catalogs", "readwrite");
      const store = transaction.objectStore("catalogs");
      if (catalog) store.put(catalog, "current");
      else store.delete("current");
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}
