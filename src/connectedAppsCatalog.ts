export type IntegrationRisk = 'read' | 'write' | 'sensitive';
export type IntegrationAuth = 'oauth2' | 'bot-token' | 'webhook' | 'local';

export interface IntegrationActionDefinition {
  id: string;
  label: string;
  risk: IntegrationRisk;
  description: string;
}

export interface ConnectedAppDefinition {
  id: string;
  name: string;
  category: '메일' | '일정' | '파일' | '협업' | '개발' | '검색·생활' | '문서·언어' | '자동화';
  description: string;
  auth: IntegrationAuth;
  actions: IntegrationActionDefinition[];
  officialSetupUrl: string;
  webhookKey: string;
}

const READ = (id: string, label: string, description: string): IntegrationActionDefinition =>
  ({ id, label, risk: 'read', description });
const WRITE = (id: string, label: string, description: string): IntegrationActionDefinition =>
  ({ id, label, risk: 'write', description });
const SENSITIVE = (id: string, label: string, description: string): IntegrationActionDefinition =>
  ({ id, label, risk: 'sensitive', description });

export const CONNECTED_APP_CATALOG: ConnectedAppDefinition[] = [
  {
    id: 'google-gmail', name: 'Gmail', category: '메일', auth: 'oauth2',
    description: '메일 검색·요약 및 사용자가 승인한 메일 발송',
    officialSetupUrl: 'https://developers.google.com/gmail/api',
    webhookKey: 'google-gmail',
    actions: [
      READ('search_messages', '메일 검색', '조건에 맞는 메일 목록을 읽습니다.'),
      READ('get_message', '메일 내용 읽기', '선택한 메일의 본문을 가져옵니다.'),
      WRITE('create_draft', '메일 초안 만들기', '발송하지 않고 초안을 저장합니다.'),
      SENSITIVE('send_message', '메일 발송', '외부 수신자에게 메일을 발송합니다.'),
    ],
  },
  {
    id: 'google-calendar', name: 'Google Calendar', category: '일정', auth: 'oauth2',
    description: '일정 조회·생성·수정. 일정 변경은 승인 후 수행',
    officialSetupUrl: 'https://developers.google.com/calendar/api',
    webhookKey: 'google-calendar',
    actions: [
      READ('list_events', '일정 조회', '기간 내 캘린더 일정을 조회합니다.'),
      WRITE('create_event', '일정 생성', '캘린더에 일정을 추가합니다.'),
      SENSITIVE('update_event', '일정 변경·취소', '기존 일정 정보를 변경하거나 취소합니다.'),
    ],
  },
  {
    id: 'google-drive', name: 'Google Drive', category: '파일', auth: 'oauth2',
    description: '파일 검색·메타데이터 조회·사용자 승인 업로드',
    officialSetupUrl: 'https://developers.google.com/drive/api',
    webhookKey: 'google-drive',
    actions: [
      READ('search_files', '파일 검색', 'Drive 파일을 검색합니다.'),
      READ('get_file', '파일 정보 읽기', '파일 메타데이터를 조회합니다.'),
      WRITE('upload_file', '파일 업로드', 'Drive에 파일을 업로드합니다.'),
      SENSITIVE('delete_file', '파일 삭제', '파일을 영구 삭제할 수 있습니다.'),
    ],
  },
  {
    id: 'microsoft-outlook', name: 'Outlook', category: '메일', auth: 'oauth2',
    description: 'Microsoft 365 메일 검색·초안·승인 발송',
    officialSetupUrl: 'https://learn.microsoft.com/graph/api/resources/mail-api-overview',
    webhookKey: 'microsoft-outlook',
    actions: [
      READ('search_messages', '메일 검색', 'Outlook 메일을 조회합니다.'),
      WRITE('create_draft', '메일 초안 만들기', '발송 전 초안을 생성합니다.'),
      SENSITIVE('send_message', '메일 발송', '외부 수신자에게 메일을 보냅니다.'),
    ],
  },
  {
    id: 'microsoft-calendar', name: 'Outlook Calendar', category: '일정', auth: 'oauth2',
    description: 'Microsoft 365 일정 조회·생성·변경',
    officialSetupUrl: 'https://learn.microsoft.com/graph/api/resources/calendar',
    webhookKey: 'microsoft-calendar',
    actions: [
      READ('list_events', '일정 조회', 'Outlook 일정을 조회합니다.'),
      WRITE('create_event', '일정 생성', '새 일정을 만듭니다.'),
      SENSITIVE('cancel_event', '일정 취소', '선택한 일정을 취소합니다.'),
    ],
  },
  {
    id: 'dropbox', name: 'Dropbox', category: '파일', auth: 'oauth2',
    description: 'Dropbox 파일 검색·다운로드·업로드·삭제',
    officialSetupUrl: 'https://www.dropbox.com/developers',
    webhookKey: 'dropbox',
    actions: [
      READ('list_files', '파일 목록', '폴더와 파일 목록을 조회합니다.'),
      READ('download_file', '파일 다운로드', '권한이 있는 파일을 다운로드합니다.'),
      WRITE('upload_file', '파일 업로드', '파일을 저장합니다.'),
      SENSITIVE('delete_file', '파일 삭제', '선택한 파일을 삭제합니다.'),
    ],
  },
  {
    id: 'notion', name: 'Notion', category: '협업', auth: 'oauth2',
    description: 'Notion 페이지·데이터베이스 검색 및 페이지 생성',
    officialSetupUrl: 'https://developers.notion.com/',
    webhookKey: 'notion',
    actions: [
      READ('search_pages', '페이지 검색', '접근이 허용된 페이지를 검색합니다.'),
      READ('get_page', '페이지 읽기', '페이지 내용을 가져옵니다.'),
      WRITE('create_page', '페이지 만들기', '새 페이지를 생성합니다.'),
      SENSITIVE('archive_page', '페이지 보관', '페이지를 보관 상태로 변경합니다.'),
    ],
  },
  {
    id: 'slack', name: 'Slack', category: '협업', auth: 'oauth2',
    description: 'Slack 검색·채널 메시지 읽기 및 승인된 메시지 전송',
    officialSetupUrl: 'https://api.slack.com/',
    webhookKey: 'slack',
    actions: [
      READ('search_messages', '메시지 검색', '접근 권한이 있는 메시지를 검색합니다.'),
      READ('list_channels', '채널 조회', '워크스페이스 채널을 조회합니다.'),
      SENSITIVE('send_message', '메시지 전송', '채널 또는 사용자에게 메시지를 보냅니다.'),
    ],
  },
  {
    id: 'github', name: 'GitHub', category: '개발', auth: 'oauth2',
    description: '저장소·이슈·PR 조회와 승인 기반 이슈/PR 생성',
    officialSetupUrl: 'https://docs.github.com/en/apps',
    webhookKey: 'github',
    actions: [
      READ('list_repositories', '저장소 조회', '접근 가능한 저장소를 조회합니다.'),
      READ('search_issues', '이슈·PR 검색', '이슈와 Pull Request를 검색합니다.'),
      WRITE('create_issue', '이슈 생성', '새 이슈를 만듭니다.'),
      SENSITIVE('merge_pull_request', 'PR 병합', '코드를 기본 브랜치에 병합합니다.'),
    ],
  },
  {
    id: 'discord', name: 'Discord', category: '협업', auth: 'bot-token',
    description: '봇이 접근 가능한 서버·채널 조회 및 승인된 알림 전송',
    officialSetupUrl: 'https://discord.com/developers/docs/intro',
    webhookKey: 'discord',
    actions: [
      READ('list_channels', '채널 조회', '봇이 접근할 수 있는 채널을 조회합니다.'),
      SENSITIVE('send_message', '메시지 전송', 'Discord 채널에 메시지를 보냅니다.'),
    ],
  },
  {
    id: 'telegram', name: 'Telegram', category: '협업', auth: 'bot-token',
    description: 'Telegram Bot API를 통한 메시지 수신·승인 발송',
    officialSetupUrl: 'https://core.telegram.org/bots/api',
    webhookKey: 'telegram',
    actions: [
      READ('get_updates', '업데이트 조회', '봇에 전달된 업데이트를 읽습니다.'),
      SENSITIVE('send_message', '메시지 전송', '채팅방에 메시지를 전송합니다.'),
    ],
  },
  {
    id: 'naver', name: 'Naver', category: '검색·생활', auth: 'oauth2',
    description: '네이버 검색 등 공식 API가 허용하는 범위의 기능',
    officialSetupUrl: 'https://developers.naver.com/',
    webhookKey: 'naver',
    actions: [
      READ('search_web', '웹 검색', '네이버 검색 API로 정보를 검색합니다.'),
      READ('search_local', '지역 검색', '지역·장소 검색 API를 호출합니다.'),
    ],
  },
  {
    id: 'kakao', name: 'Kakao', category: '검색·생활', auth: 'oauth2',
    description: '카카오 계정 연결 및 공식 API 권한 범위 내 기능',
    officialSetupUrl: 'https://developers.kakao.com/',
    webhookKey: 'kakao',
    actions: [
      READ('search_places', '장소 검색', '카카오 로컬 API로 장소를 검색합니다.'),
      SENSITIVE('send_message', '메시지 전송', '카카오 정책과 허용 범위에 맞춰 메시지를 전송합니다.'),
    ],
  },
  {
    id: 'todoist', name: 'Todoist', category: '일정', auth: 'oauth2',
    description: '할 일 조회·생성·완료 처리',
    officialSetupUrl: 'https://developer.todoist.com/',
    webhookKey: 'todoist',
    actions: [
      READ('list_tasks', '할 일 조회', '열린 할 일 목록을 조회합니다.'),
      WRITE('create_task', '할 일 추가', '새 할 일을 만듭니다.'),
      SENSITIVE('complete_task', '할 일 완료', '선택한 할 일을 완료 처리합니다.'),
    ],
  },
  {
    id: 'trello', name: 'Trello', category: '협업', auth: 'oauth2',
    description: '보드·카드 조회 및 승인된 카드 생성',
    officialSetupUrl: 'https://developer.atlassian.com/cloud/trello/',
    webhookKey: 'trello',
    actions: [
      READ('list_boards', '보드 조회', '접근 가능한 보드를 조회합니다.'),
      READ('list_cards', '카드 조회', '보드의 카드를 조회합니다.'),
      WRITE('create_card', '카드 생성', '새 카드를 만듭니다.'),
    ],
  },
  {
    id: 'linear', name: 'Linear', category: '개발', auth: 'oauth2',
    description: '프로젝트·이슈 검색 및 승인된 이슈 생성',
    officialSetupUrl: 'https://developers.linear.app/',
    webhookKey: 'linear',
    actions: [
      READ('search_issues', '이슈 검색', 'Linear 이슈를 검색합니다.'),
      WRITE('create_issue', '이슈 생성', '새 이슈를 만듭니다.'),
    ],
  },
  {
    id: 'jira', name: 'Jira', category: '개발', auth: 'oauth2',
    description: 'Jira 작업 검색 및 승인된 티켓 생성',
    officialSetupUrl: 'https://developer.atlassian.com/cloud/jira/platform/rest/v3/',
    webhookKey: 'jira',
    actions: [
      READ('search_issues', '티켓 검색', 'Jira 이슈를 검색합니다.'),
      WRITE('create_issue', '티켓 생성', '새 이슈를 만듭니다.'),
    ],
  },
  {
    id: 'google-docs', name: 'Google Docs', category: '파일', auth: 'oauth2',
    description: '문서 검색·읽기·초안 생성 및 게시 승인',
    officialSetupUrl: 'https://developers.google.com/docs/api',
    webhookKey: 'google-docs',
    actions: [
      READ('search_documents', '문서 검색', '접근 가능한 Google 문서를 검색합니다.'),
      READ('get_document', '문서 읽기', '선택한 문서의 내용을 가져옵니다.'),
      WRITE('create_document', '문서 초안 생성', '새 문서를 생성합니다.'),
      SENSITIVE('share_document', '문서 공유', '다른 계정에 문서 접근 권한을 부여합니다.'),
    ],
  },
  {
    id: 'google-sheets', name: 'Google Sheets', category: '파일', auth: 'oauth2',
    description: '스프레드시트 읽기·셀 업데이트 및 공유',
    officialSetupUrl: 'https://developers.google.com/sheets/api',
    webhookKey: 'google-sheets',
    actions: [
      READ('get_values', '시트 데이터 읽기', '스프레드시트 범위의 값을 가져옵니다.'),
      WRITE('update_values', '셀 데이터 입력', '지정 범위의 셀 값을 업데이트합니다.'),
      SENSITIVE('share_spreadsheet', '시트 공유', '다른 계정에 접근 권한을 부여합니다.'),
    ],
  },
  {
    id: 'microsoft-onedrive', name: 'OneDrive', category: '파일', auth: 'oauth2',
    description: 'Microsoft 365 파일 검색·다운로드·업로드·삭제',
    officialSetupUrl: 'https://learn.microsoft.com/graph/api/resources/onedrive',
    webhookKey: 'microsoft-onedrive',
    actions: [
      READ('list_files', '파일 조회', 'OneDrive 파일을 검색합니다.'),
      READ('download_file', '파일 다운로드', '선택한 파일을 가져옵니다.'),
      WRITE('upload_file', '파일 업로드', 'OneDrive에 파일을 저장합니다.'),
      SENSITIVE('delete_file', '파일 삭제', 'OneDrive 파일을 삭제합니다.'),
    ],
  },
  {
    id: 'microsoft-teams', name: 'Microsoft Teams', category: '협업', auth: 'oauth2',
    description: 'Teams 메시지 검색·회의 생성·메시지 전송',
    officialSetupUrl: 'https://learn.microsoft.com/graph/api/resources/teams-api-overview',
    webhookKey: 'microsoft-teams',
    actions: [
      READ('search_messages', '메시지 검색', '접근 가능한 Teams 메시지를 검색합니다.'),
      WRITE('create_meeting', '회의 만들기', '새 Teams 회의를 생성합니다.'),
      SENSITIVE('send_message', '메시지 전송', '팀 또는 채팅에 메시지를 전송합니다.'),
    ],
  },
  {
    id: 'airtable', name: 'Airtable', category: '협업', auth: 'oauth2',
    description: '베이스·레코드 조회 및 승인된 데이터 변경',
    officialSetupUrl: 'https://airtable.com/developers/web/api/introduction',
    webhookKey: 'airtable',
    actions: [
      READ('list_records', '레코드 조회', '접근 권한이 있는 레코드를 조회합니다.'),
      WRITE('create_record', '레코드 생성', '새 레코드를 추가합니다.'),
      SENSITIVE('update_record', '레코드 수정', '기존 레코드를 변경합니다.'),
    ],
  },
  {
    id: 'asana', name: 'Asana', category: '협업', auth: 'oauth2',
    description: '프로젝트·작업 조회와 작업 생성·수정',
    officialSetupUrl: 'https://developers.asana.com/docs',
    webhookKey: 'asana',
    actions: [
      READ('list_tasks', '작업 조회', '프로젝트의 작업을 조회합니다.'),
      WRITE('create_task', '작업 생성', '새 Asana 작업을 만듭니다.'),
      SENSITIVE('update_task', '작업 변경', '기존 작업의 상태나 담당자를 변경합니다.'),
    ],
  },
  {
    id: 'zoom', name: 'Zoom', category: '일정', auth: 'oauth2',
    description: '회의 조회·생성 및 회의 취소',
    officialSetupUrl: 'https://developers.zoom.us/docs/api/',
    webhookKey: 'zoom',
    actions: [
      READ('list_meetings', '회의 조회', '예약된 Zoom 회의를 조회합니다.'),
      WRITE('create_meeting', '회의 생성', '새 회의 링크를 생성합니다.'),
      SENSITIVE('delete_meeting', '회의 취소', '선택한 회의를 취소합니다.'),
    ],
  },
  {
    id: 'youtube', name: 'YouTube', category: '검색·생활', auth: 'oauth2',
    description: '영상 검색·재생목록 생성 및 업로드 승인',
    officialSetupUrl: 'https://developers.google.com/youtube/v3',
    webhookKey: 'youtube',
    actions: [
      READ('search_videos', '영상 검색', 'YouTube 영상을 검색합니다.'),
      WRITE('create_playlist', '재생목록 생성', '새 재생목록을 만듭니다.'),
      SENSITIVE('upload_video', '영상 업로드', '사용자 채널에 영상을 게시합니다.'),
    ],
  },
  {
    id: 'spotify', name: 'Spotify', category: '검색·생활', auth: 'oauth2',
    description: '음악 검색·재생목록 생성 및 트랙 추가',
    officialSetupUrl: 'https://developer.spotify.com/documentation/web-api',
    webhookKey: 'spotify',
    actions: [
      READ('search_tracks', '음악 검색', '트랙·아티스트를 검색합니다.'),
      WRITE('create_playlist', '재생목록 생성', '새 Spotify 재생목록을 만듭니다.'),
      SENSITIVE('add_to_playlist', '트랙 추가', '선택한 재생목록에 트랙을 추가합니다.'),
    ],
  },
  {
    id: 'wordpress', name: 'WordPress', category: '문서·언어', auth: 'oauth2',
    description: '게시물 조회·초안 작성 및 외부 공개 게시',
    officialSetupUrl: 'https://developer.wordpress.org/rest-api/',
    webhookKey: 'wordpress',
    actions: [
      READ('list_posts', '게시물 조회', 'WordPress 게시물을 조회합니다.'),
      WRITE('create_draft', '게시물 초안', '비공개 초안을 생성합니다.'),
      SENSITIVE('publish_post', '게시물 공개', '콘텐츠를 웹사이트에 공개합니다.'),
    ],
  },
  {
    id: 'custom-webhook', name: '사용자 지정 자동화', category: '자동화', auth: 'webhook',
    description: 'n8n·Make·Zapier 또는 직접 만든 HTTPS Webhook으로 다른 앱을 연결',
    officialSetupUrl: 'https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.webhook/',
    webhookKey: 'custom-webhook',
    actions: [
      READ('run_readonly', '조회 작업', '읽기 전용 자동화를 실행합니다.'),
      WRITE('run_action', '작업 실행', '외부 서비스에 작업을 요청합니다.'),
      SENSITIVE('run_sensitive_action', '중요 작업 실행', '결제·전송·삭제 등의 민감 작업을 요청합니다.'),
    ],
  },
];

export const CONNECTED_APP_CATEGORIES = ['전체', '메일', '일정', '파일', '협업', '개발', '검색·생활', '문서·언어', '자동화'] as const;
