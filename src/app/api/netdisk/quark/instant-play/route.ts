import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { createQuarkInstantPlayFolder } from '@/lib/netdisk/quark.client';
import { base58Encode } from '@/lib/utils';

export const runtime = 'nodejs';

function joinPath(...parts: string[]) {
  const joined = parts
    .filter(Boolean)
    .join('/')
    .replace(/\/+/g, '/');
  return joined.startsWith('/') ? joined : `/${joined}`;
}

export async function POST(request: NextRequest) {
  try {
    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo?.username) {
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }

    const { shareUrl, passcode, title } = await request.json();
    if (!shareUrl) {
      return NextResponse.json({ error: '分享链接不能为空' }, { status: 400 });
    }

    const config = await getConfig();
    const quarkConfig = config.NetDiskConfig?.Quark;

    if (!quarkConfig?.Enabled || !quarkConfig.Cookie) {
      return NextResponse.json({ error: '夸克网盘未配置或未启用' }, { status: 400 });
    }

    const result = await createQuarkInstantPlayFolder(quarkConfig.Cookie, {
      shareUrl,
      passcode,
      playTempSavePath: quarkConfig.PlayTempSavePath,
      title,
    });

    if (!result.folderName) {
      throw new Error('未生成临时播放目录');
    }

    const openlistFolderPath = joinPath(
      quarkConfig.OpenListTempPath,
      result.folderName
    );

    if (
      config.OpenListConfig?.Enabled &&
      config.OpenListConfig.URL &&
      config.OpenListConfig.Username &&
      config.OpenListConfig.Password
    ) {
      try {
        const { OpenListClient } = await import('@/lib/openlist.client');
        const openListClient = new OpenListClient(
          config.OpenListConfig.URL,
          config.OpenListConfig.Username,
          config.OpenListConfig.Password
        );
        await openListClient.refreshDirectory(quarkConfig.OpenListTempPath || '/');
        await openListClient.refreshDirectory(openlistFolderPath);
      } catch (refreshError) {
        console.warn('[quark instant-play] 刷新 OpenList 临时目录失败:', refreshError);
      }
    }

    return NextResponse.json({
      success: true,
      source: 'quark-temp',
      id: base58Encode(openlistFolderPath),
      title: title || result.folderName,
      openlistFolderPath,
      ...result,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '立即播放失败' },
      { status: 500 }
    );
  }
}
