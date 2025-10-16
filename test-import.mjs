import { BoundedLRU } from './src/lib/BoundedLRU.js';
const cache = new BoundedLRU({ maxSize: 3, ttlMs: 10000 });
console.log('Methods:', Object.getOwnPropertyNames(Object.getPrototypeOf(cache)));
cache.set('a', 'val');
console.log('Has getSize?', typeof cache.getSize);
console.log('Size:', cache.getSize());
