/**
 * OpenList 路径元信息工具
 * PathMeta: { [path]: { category, refresh14m } }
 * 匹配规则：规范化后最长前缀匹配
 * 例：配置 /videos 可匹配 /videos/某影片
 */

export interface OpenListPathMetaEntry {
  category: string;
  refresh14m: boolean;
}

export type OpenListPathMetaMap = Record<string, OpenListPathMetaEntry>;

export const EMPTY_PATH_META: OpenListPathMetaEntry = {
  category: '',
  refresh14m: false,
};

/**
 * 规范化路径：去 BOM / 零宽字符、trim、去掉末尾 /（根路径 / 除外）
 */
export function normalizeOpenListPath(path: string): string {
  if (!path || typeof path !== 'string') {
    return '';
  }

  let cleaned = path
    // UTF-8 BOM
    .replace(/^﻿/, '')
    .replace(/﻿/g, '')
    // zero-width chars U+200B-U+200D, U+FEFF
    .replace(/[​-‍﻿]/g, '')
    .trim()
    .replace(/\\/g, '/');

  // 去掉末尾 /（除非就是 /）
  if (cleaned.length > 1 && cleaned.endsWith('/')) {
    cleaned = cleaned.slice(0, -1);
  }

  return cleaned;
}

/**
 * 规范化 PathMeta map 的 key，合并重复路径（后者覆盖前者）
 */
export function normalizePathMetaMap(
  pathMeta: OpenListPathMetaMap | undefined | null
): OpenListPathMetaMap {
  if (!pathMeta || typeof pathMeta !== 'object') {
    return {};
  }

  const result: OpenListPathMetaMap = {};
  for (const [rawPath, entry] of Object.entries(pathMeta)) {
    const pathKey = normalizeOpenListPath(rawPath);
    if (!pathKey) continue;
    result[pathKey] = {
      category: typeof entry?.category === 'string' ? entry.category.trim() : '',
      refresh14m: Boolean(entry?.refresh14m),
    };
  }
  return result;
}

/**
 * 最长前缀匹配解析路径元信息
 * - 全等命中
 * - 或以 key + '/' 为前缀（避免 /videos 误匹配 /videos2）
 * - 多条命中时取最长 key
 */
export function resolvePathMeta(
  folderPath: string,
  pathMeta: OpenListPathMetaMap | undefined | null
): OpenListPathMetaEntry {
  const normalized = normalizeOpenListPath(folderPath);
  if (!normalized || !pathMeta) {
    return { ...EMPTY_PATH_META };
  }

  const map = normalizePathMetaMap(pathMeta);
  let bestKey = '';
  let best: OpenListPathMetaEntry | null = null;

  for (const [key, entry] of Object.entries(map)) {
    if (!key) continue;
    const matched =
      normalized === key ||
      (key === '/'
        ? normalized.startsWith('/')
        : normalized.startsWith(key + '/'));
    if (!matched) continue;
    if (key.length >= bestKey.length) {
      bestKey = key;
      best = entry;
    }
  }

  if (!best) {
    return { ...EMPTY_PATH_META };
  }

  return {
    category: best.category || '',
    refresh14m: Boolean(best.refresh14m),
  };
}

/**
 * 从 PathMeta 提取非空分类列表（去重、保序）
 */
export function listPathMetaCategories(
  pathMeta: OpenListPathMetaMap | undefined | null
): string[] {
  const map = normalizePathMetaMap(pathMeta);
  const seen = new Set<string>();
  const categories: string[] = [];
  for (const entry of Object.values(map)) {
    const cat = (entry.category || '').trim();
    if (cat && !seen.has(cat)) {
      seen.add(cat);
      categories.push(cat);
    }
  }
  return categories;
}
