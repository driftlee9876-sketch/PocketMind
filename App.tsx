// App.tsx 내 상태 및 즉시 모델 전환 / 멀티 모델 실행 연동 코드
import React, { useRef, useState } from 'react';
import { AI_MODEL_CATALOG, AIModelSpec, runAutonomousPlugins } from './src/aiModelsAndPlugins';
import {
  executeMultiModelCommand,
  getOrHotSwapLocalContext,
  StageExecutionTrace,
} from './src/multiModelOrchestrator';

// 컴포넌트 내부 상태 선언
const [selectedModelId, setSelectedModelId] = useState<string>('qwen3-4b');
const activeModelIdRef = useRef<string>('qwen3-4b');
const [installedModels, setInstalledModels] = useState<string[]>(['qwen3-4b']);
const [autoMultiModelEnabled, setAutoMultiModelEnabled] = useState<boolean>(true);
const [activeStageBanner, setActiveStageBanner] = useState<string>('');

// 1. 탭 한 번으로 지연 없이 즉시 활성 모델 변경 (로컬 RAM 풀 + 원격 워커 동기화)
const handleInstantModelSwitch = async (targetModel: AIModelSpec, stageLabel?: string) => {
  activeModelIdRef.current = targetModel.id;
  setSelectedModelId(targetModel.id);
  if (stageLabel) {
    setActiveStageBanner(stageLabel);
  }

  // 원격 GPU 워커가 연결되어 있으면 즉시 switch_model 제어 패킷 전송
  if (workerSocketRef.current && workerSocketRef.current.readyState === WebSocket.OPEN) {
    workerSocketRef.current.send(
      JSON.stringify({
        type: 'switch_model',
        modelId: targetModel.id,
        filename: targetModel.filename,
        downloadUrl: targetModel.downloadUrl,
      }),
    );
  }

  // 기기에 설치된 로컬 모델이면 백그라운드에서 즉시 RAM 컨텍스트 워밍업
  if (installedModels.includes(targetModel.id)) {
    try {
      await getOrHotSwapLocalContext(targetModel, (statusText) => {
        setActiveStageBanner(statusText);
      });
    } catch (err) {
      console.warn('로컬 모델 워밍업 경고:', err);
    }
  }
};

// 2. 단일 명령 내 멀티 모델 파이프라인 실행
const handleSendWithMultiModel = async (userPrompt: string) => {
  const pluginOutputs = await runAutonomousPlugins(userPrompt, enabledPluginIds);
  const pluginContextBlock =
    pluginOutputs.length > 0
      ? `\n[자율 실행 플러그인 결과]\n${pluginOutputs.map((p) => `- ${p.title}: ${p.result}`).join('\n')}`
      : '';

  const liveTraces: StageExecutionTrace[] = [];

  const result = await executeMultiModelCommand({
    rawPrompt: userPrompt,
    pluginContextBlock,
    installedModelIds: installedModels,
    currentModelId: activeModelIdRef.current,
    remoteWorkerConnected:
      Boolean(workerSocketRef.current) && workerSocketRef.current?.readyState === WebSocket.OPEN,
    autoMultiModelEnabled,
    onModelHotSwap: (swappedModel, label) => {
      activeModelIdRef.current = swappedModel.id;
      setSelectedModelId(swappedModel.id);
      setActiveStageBanner(label);
    },
    onStageProgress: (trace) => {
      liveTraces.push(trace);
      setActiveStageBanner(
        `완료: ${trace.roleTitle} (${trace.modelShortName}, ${(trace.elapsedMs / 1000).toFixed(1)}초)`,
      );
    },
    runRemoteInference: async (model, systemPrompt, stagePrompt) => {
      return await sendRequestToRemoteWorker({
        modelId: model.id,
        filename: model.filename,
        downloadUrl: model.downloadUrl,
        systemPrompt,
        prompt: stagePrompt,
      });
    },
  });

  setActiveStageBanner('');
  const chainHeader =
    result.traces.length > 1
      ? `🔗 **멀티 모델 체인 실행**: ${result.traces
          .map((t) => `${t.stageIndex}단계 ${t.modelShortName}`)
          .join(' → ')}\n\n`
      : `⚡ **활성 모델**: ${result.traces[0]?.modelShortName || activeModelIdRef.current}\n\n`;

  return `${chainHeader}${result.finalResponse}`;
};
