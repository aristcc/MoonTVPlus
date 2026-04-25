import { NextRequest, NextResponse } from 'next/server';

import { extractSongmid, isMusicSource, lxPostJson, normalizeMusicQuality, normalizeSong } from '@/lib/music-v2';
import { badRequest } from '@/lib/music-v2-api';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const source = searchParams.get('source') || '';
    const songId = searchParams.get('songId') || '';
    const quality = normalizeMusicQuality(searchParams.get('quality') || '320k');

    if (!isMusicSource(source)) return badRequest('不支持的音源');
    if (!songId) return badRequest('缺少歌曲ID');

    const song = normalizeSong({
      songId,
      source,
      songmid: searchParams.get('songmid') || undefined,
      name: searchParams.get('name') || '',
      artist: searchParams.get('artist') || '',
      durationText: searchParams.get('durationText') || undefined,
      hash: searchParams.get('hash') || undefined,
      copyrightId: searchParams.get('copyrightId') || undefined,
      albumId: searchParams.get('albumId') || undefined,
      lrcUrl: searchParams.get('lrcUrl') || undefined,
      mrcUrl: searchParams.get('mrcUrl') || undefined,
      trcUrl: searchParams.get('trcUrl') || undefined,
    });

    const urlResult = await lxPostJson<{ url?: string; error?: string }>(
      '/api/music/url',
      {
        songInfo: {
          id: song.songId,
          name: song.name,
          singer: song.artist,
          source: song.source,
          songmid: extractSongmid(song),
          hash: song.hash,
          interval: song.durationText,
          copyrightId: song.copyrightId,
          albumId: song.albumId,
          lrcUrl: song.lrcUrl,
          mrcUrl: song.mrcUrl,
          trcUrl: song.trcUrl,
        },
        quality,
      },
      'auto'
    );

    const upstreamUrl = urlResult?.url;
    if (!upstreamUrl) {
      return NextResponse.json({ success: false, error: { code: 'STREAM_FAILED', message: urlResult?.error || '获取音频流失败' } }, { status: 502 });
    }

    const headers = new Headers();
    headers.set('User-Agent', 'Mozilla/5.0');
    const range = request.headers.get('range');
    if (range) headers.set('Range', range);

    const upstream = await fetch(upstreamUrl, {
      headers,
      signal: AbortSignal.timeout(30000),
    });

    if (!upstream.ok && upstream.status !== 206) {
      return NextResponse.json({ success: false, error: { code: 'STREAM_FAILED', message: '获取音频流失败' } }, { status: upstream.status });
    }

    const responseHeaders = new Headers();
    responseHeaders.set('Content-Type', upstream.headers.get('content-type') || 'audio/mpeg');
    responseHeaders.set('Cache-Control', 'public, max-age=31536000, immutable');
    responseHeaders.set('Accept-Ranges', upstream.headers.get('accept-ranges') || 'bytes');
    responseHeaders.set('Access-Control-Allow-Origin', '*');

    const copyHeaders = ['content-length', 'content-range', 'etag', 'last-modified'];
    for (const header of copyHeaders) {
      const value = upstream.headers.get(header);
      if (value) responseHeaders.set(header, value);
    }

    return new NextResponse(upstream.body, {
      status: upstream.status,
      headers: responseHeaders,
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: { code: 'STREAM_FAILED', message: (error as Error).message } }, { status: 400 });
  }
}
