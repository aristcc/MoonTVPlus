/* eslint-disable @typescript-eslint/no-explicit-any, no-console */

const QUARK_SHARE_API_BASE = 'https://drive-h.quark.cn/1/clouddrive';
const QUARK_DRIVE_API_BASE = 'https://drive-pc.quark.cn/1/clouddrive';
const QUARK_QUERY = 'pr=ucpro&fr=pc';

export interface QuarkShareLinkInfo {
  pwdId: string;
  passcode: string;
}

export interface QuarkShareItem {
  fid: string;
  fileName: string;
  dir: boolean;
  shareFidToken?: string;
  pdirFid?: string;
}

export interface QuarkTransferTaskResult {
  taskId?: string;
  fileCount: number;
  targetPath: string;
  folderName?: string;
  skipped?: boolean;
  reused?: boolean;
}

const VIDEO_EXTENSIONS = [
  '.mp4',
  '.mkv',
  '.avi',
  '.m3u8',
  '.flv',
  '.ts',
  '.mov',
  '.wmv',
  '.webm',
  '.rmvb',
  '.rm',
  '.mpg',
  '.mpeg',
  '.3gp',
  '.f4v',
  '.m4v',
  '.vob',
];

function buildApiUrl(base: string, path: string, query = '') {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${base}${normalizedPath}?${QUARK_QUERY}${query ? `&${query}` : ''}`;
}

function getHeaders(cookie: string): HeadersInit {
  return {
    'content-type': 'application/json',
    cookie,
    origin: 'https://pan.quark.cn',
    referer: 'https://pan.quark.cn/',
    'user-agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
  };
}

export function normalizeQuarkCookie(cookie: string): string {
  return cookie
    .replace(/；/g, ';')
    .replace(/：/g, ':')
    .replace(/，/g, ',')
    .trim();
}

export function assertQuarkCookieHeaderSafe(cookie: string): string {
  const normalized = normalizeQuarkCookie(cookie);
  for (let i = 0; i < normalized.length; i += 1) {
    if (normalized.charCodeAt(i) > 255) {
      throw new Error('夸克 Cookie 含有非法字符，请确认没有中文标点、中文空格或说明文字');
    }
  }
  return normalized;
}

function normalizePath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed || trimmed === '/') return '/';
  return `/${trimmed.replace(/^\/+|\/+$/g, '')}`;
}

function joinPath(...parts: string[]) {
  const joined = parts
    .filter(Boolean)
    .join('/')
    .replace(/\/+/g, '/');
  return normalizePath(joined);
}

function sanitizeFolderName(name: string) {
  return (name || 'quark-temp')
    .replace(/[<>:"/\\|?*]/g, ' ')
    .replace(/[\r\n\t]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

async function parseJson(response: Response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`夸克接口返回异常：${text.slice(0, 200)}`);
  }
}

function ensureOk(data: any, fallbackMessage: string) {
  if (data?.code === 0 || data?.code === 200 || data?.status === 200) {
    return;
  }
  throw new Error(data?.message || data?.msg || fallbackMessage);
}

export function parseQuarkShareUrl(url: string, passcode = ''): QuarkShareLinkInfo {
  const parsed = new URL(url);
  const pwdId =
    parsed.pathname.match(/\/s\/([A-Za-z0-9_-]+)/)?.[1] ||
    parsed.searchParams.get('pwd_id') ||
    '';

  if (!pwdId) {
    throw new Error('无法解析夸克分享链接');
  }

  return {
    pwdId,
    passcode:
      passcode ||
      parsed.searchParams.get('pwd') ||
      parsed.searchParams.get('passcode') ||
      '',
  };
}

async function fetchShareToken(cookie: string, share: QuarkShareLinkInfo) {
  const response = await fetch(
    buildApiUrl(QUARK_SHARE_API_BASE, '/share/sharepage/token'),
    {
      method: 'POST',
      headers: getHeaders(cookie),
      body: JSON.stringify({
        pwd_id: share.pwdId,
        passcode: share.passcode,
      }),
    }
  );

  const data = await parseJson(response);
  ensureOk(data, '获取夸克分享 token 失败');

  const stoken =
    data?.data?.stoken ||
    data?.data?.share_token ||
    data?.data?.token;

  if (!stoken) {
    throw new Error('夸克分享 token 缺失');
  }

  return {
    stoken,
    shareTitle: data?.data?.title || '',
  };
}

async function fetchShareFolderItems(
  cookie: string,
  pwdId: string,
  stoken: string,
  pdirFid = '0'
): Promise<QuarkShareItem[]> {
  const query = new URLSearchParams({
    pwd_id: pwdId,
    stoken,
    pdir_fid: pdirFid,
    _page: '1',
    _size: '200',
    _fetch_banner: '0',
  });

  const response = await fetch(
    buildApiUrl(QUARK_SHARE_API_BASE, '/share/sharepage/detail', query.toString()),
    {
      method: 'GET',
      headers: getHeaders(cookie),
    }
  );

  const data = await parseJson(response);
  ensureOk(data, '获取夸克分享详情失败');

  const list = data?.data?.list || [];
  return list.map((item: any) => ({
    fid: String(item.fid || item.file_id || ''),
    fileName: String(item.file_name || item.name || ''),
    dir: Boolean(item.dir || item.is_dir || item.file_type === 0),
    shareFidToken:
      item.share_fid_token || item.fid_token || item.share_token || undefined,
    pdirFid: String(item.pdir_fid || pdirFid || '0'),
  }));
}

async function fetchDriveFolderItems(
  cookie: string,
  pdirFid = '0',
  page = 1,
  size = 200
): Promise<any[]> {
  const query = new URLSearchParams({
    pdir_fid: pdirFid,
    _page: String(page),
    _size: String(size),
    _sort: 'file_type:asc,file_name:asc',
  });

  const response = await fetch(
    buildApiUrl(QUARK_DRIVE_API_BASE, '/file/sort', query.toString()),
    {
      method: 'GET',
      headers: getHeaders(cookie),
    }
  );

  const data = await parseJson(response);
  ensureOk(data, '获取夸克目录列表失败');
  return data?.data?.list || [];
}

async function fetchAllDriveFolderItems(
  cookie: string,
  pdirFid = '0'
): Promise<any[]> {
  const allItems: any[] = [];
  const pageSize = 200;

  for (let page = 1; page < 100; page += 1) {
    const items = await fetchDriveFolderItems(cookie, pdirFid, page, pageSize);
    allItems.push(...items);

    if (items.length < pageSize) {
      break;
    }
  }

  return allItems;
}

function getDriveItemName(item: any): string {
  return String(item?.file_name || item?.name || '');
}

function buildInstantPlayFolderName(pwdId: string, title?: string) {
  const baseName = sanitizeFolderName(title || 'quark-temp') || 'quark-temp';
  return `${baseName}_${pwdId}`.slice(0, 120);
}

async function findDirectoryByName(
  cookie: string,
  parentFid: string,
  folderName: string
): Promise<any | null> {
  const items = await fetchAllDriveFolderItems(cookie, parentFid);
  return items.find(
    (item: any) => Boolean(item.dir || item.is_dir) && getDriveItemName(item) === folderName
  ) || null;
}

export async function validateQuarkCookieReadable(cookie: string): Promise<void> {
  const safeCookie = assertQuarkCookieHeaderSafe(cookie);
  await fetchDriveFolderItems(safeCookie, '0');
}

async function createDriveFolder(
  cookie: string,
  parentFid: string,
  folderName: string
) {
  const response = await fetch(buildApiUrl(QUARK_DRIVE_API_BASE, '/file'), {
    method: 'POST',
    headers: getHeaders(cookie),
    body: JSON.stringify({
      pdir_fid: parentFid,
      file_name: folderName,
      dir_path: '',
      dir_init_lock: false,
    }),
  });

  const data = await parseJson(response);
  ensureOk(data, `创建夸克目录失败：${folderName}`);

  const fid =
    data?.data?.fid ||
    data?.data?.file_id ||
    data?.metadata?.fid;

  if (!fid) {
    throw new Error(`夸克目录创建成功但未返回 fid：${folderName}`);
  }

  return String(fid);
}

export async function ensureQuarkDrivePath(
  cookie: string,
  inputPath: string
): Promise<{ fid: string; path: string }> {
  const normalized = normalizePath(inputPath);
  if (normalized === '/') {
    return { fid: '0', path: normalized };
  }

  const segments = normalized.split('/').filter(Boolean);
  let currentFid = '0';
  let currentPath = '';

  for (const segment of segments) {
    const items = await fetchDriveFolderItems(cookie, currentFid);
    const existed = items.find(
      (item: any) =>
        Boolean(item.dir || item.is_dir) &&
        String(item.file_name || item.name || '') === segment
    );

    currentPath = joinPath(currentPath, segment);

    if (existed) {
      currentFid = String(existed.fid || existed.file_id);
      continue;
    }

    currentFid = await createDriveFolder(cookie, currentFid, segment);
  }

  return {
    fid: currentFid,
    path: currentPath || '/',
  };
}

async function collectShareItemsRecursive(
  cookie: string,
  pwdId: string,
  stoken: string,
  pdirFid = '0'
): Promise<QuarkShareItem[]> {
  const items = await fetchShareFolderItems(cookie, pwdId, stoken, pdirFid);
  const result: QuarkShareItem[] = [];

  for (const item of items) {
    if (item.dir) {
      const children = await collectShareItemsRecursive(
        cookie,
        pwdId,
        stoken,
        item.fid
      );
      result.push(...children);
    } else {
      result.push(item);
    }
  }

  return result;
}

function isVideoFile(fileName: string) {
  const lower = fileName.toLowerCase();
  return VIDEO_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

async function submitSaveTask(
  cookie: string,
  share: QuarkShareLinkInfo,
  stoken: string,
  toPdirFid: string,
  items: QuarkShareItem[]
) {
  if (items.length === 0) {
    throw new Error('没有可保存的文件');
  }

  const response = await fetch(
    buildApiUrl(QUARK_SHARE_API_BASE, '/share/sharepage/save'),
    {
      method: 'POST',
      headers: getHeaders(cookie),
      body: JSON.stringify({
        pwd_id: share.pwdId,
        stoken,
        pdir_fid: '0',
        to_pdir_fid: toPdirFid,
        scene: 'link',
        filelist: items.map((item) => item.fid),
        fid_list: items.map((item) => item.fid),
        fid_token_list: items.map((item) => item.shareFidToken || ''),
        share_fid_token_list: items.map((item) => item.shareFidToken || ''),
      }),
    }
  );

  const data = await parseJson(response);
  ensureOk(data, '提交夸克转存任务失败');
  return data?.data?.task_id ? String(data.data.task_id) : undefined;
}

async function pollTask(cookie: string, taskId: string) {
  for (let i = 0; i < 25; i += 1) {
    const query = new URLSearchParams({
      task_id: taskId,
      retry_index: String(i),
    });

    const response = await fetch(buildApiUrl(QUARK_SHARE_API_BASE, '/task', query.toString()), {
      method: 'GET',
      headers: getHeaders(cookie),
    });

    const data = await parseJson(response);
    ensureOk(data, '查询夸克任务状态失败');

    const task = data?.data || {};
    if (
      task?.status === 2 ||
      task?.status === 'finished' ||
      task?.status === 'success' ||
      task?.finished_at
    ) {
      return;
    }

    if (
      task?.status === -1 ||
      task?.status === 'failed' ||
      task?.err_code
    ) {
      throw new Error(task?.message || task?.err_msg || '夸克任务执行失败');
    }

    await new Promise((resolve) => setTimeout(resolve, 1200));
  }

  throw new Error('夸克任务处理超时');
}

export async function transferQuarkShare(
  cookie: string,
  input: {
    shareUrl: string;
    passcode?: string;
    savePath: string;
  }
): Promise<QuarkTransferTaskResult> {
  const safeCookie = assertQuarkCookieHeaderSafe(cookie);
  const share = parseQuarkShareUrl(input.shareUrl, input.passcode);
  const { stoken } = await fetchShareToken(safeCookie, share);
  const topLevelItems = await fetchShareFolderItems(safeCookie, share.pwdId, stoken, '0');
  const target = await ensureQuarkDrivePath(safeCookie, input.savePath);
  const existedItems = await fetchAllDriveFolderItems(safeCookie, target.fid);
  const existedNames = new Set(existedItems.map((item: any) => getDriveItemName(item)));
  const pendingItems = topLevelItems.filter((item) => !existedNames.has(item.fileName));

  if (pendingItems.length === 0) {
    return {
      fileCount: 0,
      targetPath: target.path,
      skipped: true,
    };
  }

  const taskId = await submitSaveTask(safeCookie, share, stoken, target.fid, pendingItems);

  if (taskId) {
    await pollTask(safeCookie, taskId);
  }

  return {
    taskId,
    fileCount: pendingItems.length,
    targetPath: target.path,
  };
}

export async function createQuarkInstantPlayFolder(
  cookie: string,
  input: {
    shareUrl: string;
    passcode?: string;
    playTempSavePath: string;
    title?: string;
  }
): Promise<QuarkTransferTaskResult> {
  const safeCookie = assertQuarkCookieHeaderSafe(cookie);
  const share = parseQuarkShareUrl(input.shareUrl, input.passcode);
  const { stoken, shareTitle } = await fetchShareToken(safeCookie, share);
  const allItems = await collectShareItemsRecursive(safeCookie, share.pwdId, stoken, '0');
  const videoItems = allItems.filter((item) => !item.dir && isVideoFile(item.fileName));

  if (videoItems.length === 0) {
    throw new Error('分享中没有可播放的视频文件');
  }

  const tempRoot = await ensureQuarkDrivePath(safeCookie, input.playTempSavePath);
  const folderName = buildInstantPlayFolderName(share.pwdId, input.title || shareTitle);
  const existedFolder = await findDirectoryByName(safeCookie, tempRoot.fid, folderName);

  if (existedFolder) {
    return {
      fileCount: videoItems.length,
      targetPath: joinPath(tempRoot.path, folderName),
      folderName,
      reused: true,
    };
  }

  const folderFid = await createDriveFolder(safeCookie, tempRoot.fid, folderName);
  const taskId = await submitSaveTask(safeCookie, share, stoken, folderFid, videoItems);

  if (taskId) {
    await pollTask(safeCookie, taskId);
  }

  const targetPath = joinPath(tempRoot.path, folderName);

  return {
    taskId,
    fileCount: videoItems.length,
    targetPath,
    folderName,
  };
}
