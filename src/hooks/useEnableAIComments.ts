import { useEffect, useState } from 'react';

interface RuntimeConfig {
  AI_ENABLED?: boolean;
  AIConfig?: {
    EnableAIComments?: boolean;
  };
}

export function useEnableAIComments(): boolean {
  const [enableAIComments, setEnableAIComments] = useState(false);

  useEffect(() => {
    // 在客户端获取运行时配置
    if (typeof window !== 'undefined') {
      const runtimeConfig = (window as any).RUNTIME_CONFIG as RuntimeConfig;
      setEnableAIComments(
        Boolean(runtimeConfig?.AI_ENABLED && runtimeConfig?.AIConfig?.EnableAIComments)
      );
    }
  }, []);

  return enableAIComments;
}
