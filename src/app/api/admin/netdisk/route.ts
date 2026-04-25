/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig, setCachedConfig } from '@/lib/config';
import { db } from '@/lib/db';
import {
  assertQuarkCookieHeaderSafe,
  normalizeQuarkCookie,
  validateQuarkCookieReadable,
} from '@/lib/netdisk/quark.client';

export const runtime = 'nodejs';

function requireOwner(username: string | undefined) {
  return username === process.env.USERNAME;
}

export async function POST(request: NextRequest) {
  const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
  if (storageType === 'localstorage') {
    return NextResponse.json(
      { error: '不支持本地存储进行管理员配置' },
      { status: 400 }
    );
  }

  try {
    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo?.username) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!requireOwner(authInfo.username)) {
      const userInfo = await db.getUserInfoV2(authInfo.username);
      if (!userInfo || userInfo.role !== 'admin' || userInfo.banned) {
        return NextResponse.json({ error: '权限不足' }, { status: 401 });
      }
    }

    const body = await request.json();
    const { action, Quark } = body;
    const adminConfig = await getConfig();

    if (action === 'save') {
      const normalizedCookie = Quark?.Cookie ? assertQuarkCookieHeaderSafe(Quark.Cookie) : '';

      adminConfig.NetDiskConfig = adminConfig.NetDiskConfig || {};
      adminConfig.NetDiskConfig.Quark = {
        Enabled: Boolean(Quark?.Enabled),
        Cookie: normalizedCookie,
        SavePath: Quark?.SavePath || '/',
        PlayTempSavePath: Quark?.PlayTempSavePath || '/',
        OpenListTempPath: Quark?.OpenListTempPath || '/',
      };

      await db.saveAdminConfig(adminConfig);
      await setCachedConfig(adminConfig);

      return NextResponse.json({ success: true, message: '保存成功' });
    }

    if (action === 'validate') {
      if (!Quark?.Cookie) {
        return NextResponse.json({ error: '请先填写夸克 Cookie' }, { status: 400 });
      }

      await validateQuarkCookieReadable(normalizeQuarkCookie(Quark.Cookie));

      return NextResponse.json({
        success: true,
        message: '夸克cookie正常',
      });
    }

    return NextResponse.json({ error: '未知操作' }, { status: 400 });
  } catch (error) {
    console.error('[Admin NetDisk] 操作失败:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '操作失败' },
      { status: 500 }
    );
  }
}
