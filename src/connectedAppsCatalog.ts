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
  category: '메일' | '일정' | '파일' | '협업' | '개발' | '검색·생활' | '문서·언어' | 'CRM·고객' | '소셜' | '쇼핑·결제' | '인프라' | '자동화';
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
      READ('read_content', '파일 본문 읽기', 'Google 문서·PDF·텍스트 본문을 읽습니다.'),
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
    id: 'google-contacts', name: 'Google Contacts', category: '협업', auth: 'oauth2',
    description: '연락처 검색·생성·수정', officialSetupUrl: 'https://developers.google.com/people', webhookKey: 'google-contacts',
    actions: [READ('search_contacts', '연락처 검색', '연락처를 검색합니다.'), WRITE('create_contact', '연락처 생성', '연락처를 추가합니다.'), SENSITIVE('update_contact', '연락처 수정', '기존 연락처를 변경합니다.')],
  },
  {
    id: 'google-tasks', name: 'Google Tasks', category: '일정', auth: 'oauth2',
    description: '할 일 조회·생성·완료', officialSetupUrl: 'https://developers.google.com/tasks', webhookKey: 'google-tasks',
    actions: [READ('list_tasks', '할 일 조회', '할 일 목록을 읽습니다.'), WRITE('create_task', '할 일 생성', '할 일을 추가합니다.'), SENSITIVE('complete_task', '할 일 완료', '할 일을 완료 처리합니다.')],
  },
  {
    id: 'box', name: 'Box', category: '파일', auth: 'oauth2',
    description: 'Box 파일 검색·업로드·삭제', officialSetupUrl: 'https://developer.box.com/', webhookKey: 'box',
    actions: [READ('search_files', '파일 검색', 'Box 파일을 검색합니다.'), WRITE('upload_file', '파일 업로드', '파일을 업로드합니다.'), SENSITIVE('delete_file', '파일 삭제', 'Box 파일을 삭제합니다.')],
  },
  {
    id: 'gitlab', name: 'GitLab', category: '개발', auth: 'oauth2',
    description: '프로젝트·이슈 조회 및 Merge Request 작업', officialSetupUrl: 'https://docs.gitlab.com/api/', webhookKey: 'gitlab',
    actions: [READ('list_projects', '프로젝트 조회', '프로젝트를 조회합니다.'), READ('search_issues', '이슈 검색', '이슈를 검색합니다.'), WRITE('create_issue', '이슈 생성', '새 이슈를 만듭니다.'), SENSITIVE('merge_request', 'Merge Request 병합', 'Merge Request를 병합합니다.')],
  },
  {
    id: 'bitbucket', name: 'Bitbucket', category: '개발', auth: 'oauth2',
    description: '저장소·Pull Request 조회 및 이슈 생성', officialSetupUrl: 'https://developer.atlassian.com/cloud/bitbucket/rest/', webhookKey: 'bitbucket',
    actions: [READ('list_repositories', '저장소 조회', '저장소를 조회합니다.'), READ('list_pull_requests', 'Pull Request 조회', 'Pull Request를 조회합니다.'), WRITE('create_issue', '이슈 생성', '이슈를 만듭니다.')],
  },
  {
    id: 'figma', name: 'Figma', category: '협업', auth: 'oauth2',
    description: '파일·프로젝트 조회 및 댓글 작성', officialSetupUrl: 'https://www.figma.com/developers/api', webhookKey: 'figma',
    actions: [READ('get_file', '파일 조회', 'Figma 파일 정보를 가져옵니다.'), READ('list_projects', '프로젝트 조회', '프로젝트를 조회합니다.'), WRITE('create_comment', '댓글 작성', '파일에 댓글을 남깁니다.')],
  },
  {
    id: 'clickup', name: 'ClickUp', category: '협업', auth: 'oauth2',
    description: '작업 조회·생성·상태 변경', officialSetupUrl: 'https://developer.clickup.com/', webhookKey: 'clickup',
    actions: [READ('list_tasks', '작업 조회', '작업을 조회합니다.'), WRITE('create_task', '작업 생성', '작업을 생성합니다.'), SENSITIVE('update_task', '작업 변경', '작업 상태와 내용을 변경합니다.')],
  },
  {
    id: 'monday', name: 'monday.com', category: '협업', auth: 'oauth2',
    description: '보드·항목 조회 및 항목 생성', officialSetupUrl: 'https://developer.monday.com/api-reference/docs', webhookKey: 'monday',
    actions: [READ('list_boards', '보드 조회', '보드를 조회합니다.'), READ('list_items', '항목 조회', '보드 항목을 조회합니다.'), WRITE('create_item', '항목 생성', '새 항목을 만듭니다.')],
  },
  {
    id: 'salesforce', name: 'Salesforce', category: 'CRM·고객', auth: 'oauth2',
    description: 'CRM 고객·리드 조회 및 레코드 생성', officialSetupUrl: 'https://developer.salesforce.com/docs/apis', webhookKey: 'salesforce',
    actions: [READ('search_records', '레코드 검색', 'CRM 레코드를 검색합니다.'), READ('get_customer', '고객 조회', '고객 정보를 조회합니다.'), WRITE('create_lead', '리드 생성', '새 리드를 추가합니다.'), SENSITIVE('update_record', '레코드 변경', 'CRM 레코드를 변경합니다.')],
  },
  {
    id: 'hubspot', name: 'HubSpot', category: 'CRM·고객', auth: 'oauth2',
    description: '연락처·거래 조회 및 CRM 업데이트', officialSetupUrl: 'https://developers.hubspot.com/docs/api/overview', webhookKey: 'hubspot',
    actions: [READ('search_contacts', '연락처 검색', '연락처를 검색합니다.'), READ('list_deals', '거래 조회', '거래를 조회합니다.'), WRITE('create_contact', '연락처 생성', 'CRM 연락처를 만듭니다.'), SENSITIVE('update_deal', '거래 변경', '거래 상태를 변경합니다.')],
  },
  {
    id: 'zendesk', name: 'Zendesk', category: 'CRM·고객', auth: 'oauth2',
    description: '고객지원 티켓 조회·생성·상태 변경', officialSetupUrl: 'https://developer.zendesk.com/api-reference/', webhookKey: 'zendesk',
    actions: [READ('search_tickets', '티켓 검색', '지원 티켓을 검색합니다.'), WRITE('create_ticket', '티켓 생성', '새 티켓을 만듭니다.'), SENSITIVE('update_ticket', '티켓 변경', '티켓 상태나 답변을 변경합니다.')],
  },
  {
    id: 'freshdesk', name: 'Freshdesk', category: 'CRM·고객', auth: 'oauth2',
    description: '지원 티켓 조회·작성·업데이트', officialSetupUrl: 'https://developers.freshdesk.com/api/', webhookKey: 'freshdesk',
    actions: [READ('list_tickets', '티켓 조회', '티켓을 조회합니다.'), WRITE('create_ticket', '티켓 생성', '티켓을 생성합니다.'), SENSITIVE('update_ticket', '티켓 변경', '티켓을 변경합니다.')],
  },
  {
    id: 'calendly', name: 'Calendly', category: '일정', auth: 'oauth2',
    description: '예약 유형·예정 일정 조회 및 예약 취소', officialSetupUrl: 'https://developer.calendly.com/', webhookKey: 'calendly',
    actions: [READ('list_events', '예약 조회', '예정된 예약을 조회합니다.'), READ('list_event_types', '예약 유형 조회', '예약 가능한 유형을 조회합니다.'), SENSITIVE('cancel_event', '예약 취소', '예약을 취소합니다.')],
  },
  {
    id: 'reddit', name: 'Reddit', category: '소셜', auth: 'oauth2',
    description: '게시물 검색·저장 및 댓글 작성', officialSetupUrl: 'https://www.reddit.com/dev/api/', webhookKey: 'reddit',
    actions: [READ('search_posts', '게시물 검색', 'Reddit 게시물을 검색합니다.'), WRITE('save_post', '게시물 저장', '게시물을 저장합니다.'), SENSITIVE('create_comment', '댓글 작성', '공개 댓글을 작성합니다.')],
  },
  {
    id: 'mastodon', name: 'Mastodon', category: '소셜', auth: 'oauth2',
    description: '타임라인 조회 및 게시물 작성', officialSetupUrl: 'https://docs.joinmastodon.org/api/', webhookKey: 'mastodon',
    actions: [READ('read_timeline', '타임라인 조회', '타임라인을 읽습니다.'), WRITE('create_draft', '게시물 초안', '게시물 초안을 만듭니다.'), SENSITIVE('publish_status', '게시물 공개', '게시물을 공개합니다.')],
  },
  {
    id: 'rss', name: 'RSS·Atom', category: '검색·생활', auth: 'local',
    description: 'RSS·Atom 피드 읽기 및 요약', officialSetupUrl: 'https://www.rssboard.org/rss-specification', webhookKey: 'rss',
    actions: [READ('read_feed', '피드 읽기', 'RSS·Atom 피드를 읽습니다.'), READ('summarize_feed', '피드 요약', '최근 항목을 요약합니다.')],
  },
  {
    id: 'shopify', name: 'Shopify', category: '쇼핑·결제', auth: 'oauth2',
    description: '상품·주문 조회 및 상품 업데이트', officialSetupUrl: 'https://shopify.dev/docs/api', webhookKey: 'shopify',
    actions: [READ('list_products', '상품 조회', '상품을 조회합니다.'), READ('list_orders', '주문 조회', '주문을 조회합니다.'), WRITE('create_draft_order', '임시 주문 생성', '임시 주문을 만듭니다.'), SENSITIVE('update_product', '상품 변경', '상품 정보를 변경합니다.')],
  },
  {
    id: 'woocommerce', name: 'WooCommerce', category: '쇼핑·결제', auth: 'oauth2',
    description: '상품·주문 조회 및 상품 업데이트', officialSetupUrl: 'https://woocommerce.github.io/woocommerce-rest-api-docs/', webhookKey: 'woocommerce',
    actions: [READ('list_products', '상품 조회', '상품을 조회합니다.'), READ('list_orders', '주문 조회', '주문을 조회합니다.'), SENSITIVE('update_order', '주문 변경', '주문 상태를 변경합니다.')],
  },
  {
    id: 'stripe', name: 'Stripe', category: '쇼핑·결제', auth: 'oauth2',
    description: '결제·고객 조회 및 환불 요청', officialSetupUrl: 'https://docs.stripe.com/api', webhookKey: 'stripe',
    actions: [READ('list_payments', '결제 조회', '결제 내역을 조회합니다.'), READ('get_customer', '고객 조회', '고객 정보를 조회합니다.'), SENSITIVE('create_refund', '환불 실행', '결제를 환불합니다.')],
  },
  {
    id: 'paypal', name: 'PayPal', category: '쇼핑·결제', auth: 'oauth2',
    description: '거래 조회 및 환불 요청', officialSetupUrl: 'https://developer.paypal.com/api/rest/', webhookKey: 'paypal',
    actions: [READ('list_transactions', '거래 조회', '거래를 조회합니다.'), SENSITIVE('create_refund', '환불 실행', '거래를 환불합니다.')],
  },
  {
    id: 'cloudflare', name: 'Cloudflare', category: '인프라', auth: 'oauth2',
    description: '도메인·DNS·Worker 상태 조회 및 설정 변경', officialSetupUrl: 'https://developers.cloudflare.com/api/', webhookKey: 'cloudflare',
    actions: [READ('list_zones', '도메인 조회', 'Cloudflare Zone을 조회합니다.'), READ('list_dns_records', 'DNS 조회', 'DNS 레코드를 조회합니다.'), WRITE('create_dns_record', 'DNS 생성', 'DNS 레코드를 생성합니다.'), SENSITIVE('delete_dns_record', 'DNS 삭제', 'DNS 레코드를 삭제합니다.')],
  },
  {
    id: 'aws-s3', name: 'Amazon S3', category: '인프라', auth: 'local',
    description: 'S3 버킷·객체 조회 및 파일 업로드', officialSetupUrl: 'https://docs.aws.amazon.com/AmazonS3/latest/API/Welcome.html', webhookKey: 'aws-s3',
    actions: [READ('list_buckets', '버킷 조회', 'S3 버킷을 조회합니다.'), READ('list_objects', '객체 조회', '객체를 조회합니다.'), WRITE('upload_object', '객체 업로드', '파일을 업로드합니다.'), SENSITIVE('delete_object', '객체 삭제', '객체를 삭제합니다.')],
  },
  {
    id: 'supabase', name: 'Supabase', category: '인프라', auth: 'oauth2',
    description: '프로젝트·데이터 조회 및 데이터 변경', officialSetupUrl: 'https://supabase.com/docs/reference/api', webhookKey: 'supabase',
    actions: [READ('list_projects', '프로젝트 조회', '프로젝트를 조회합니다.'), READ('query_rows', '데이터 조회', '허용된 테이블 데이터를 조회합니다.'), SENSITIVE('mutate_rows', '데이터 변경', '테이블 데이터를 변경합니다.')],
  },
  {
    id: 'twilio', name: 'Twilio', category: '메일', auth: 'local',
    description: '메시지 기록 조회 및 SMS 발송', officialSetupUrl: 'https://www.twilio.com/docs/usage/api', webhookKey: 'twilio',
    actions: [READ('list_messages', '메시지 조회', '메시지 기록을 조회합니다.'), SENSITIVE('send_sms', 'SMS 발송', '외부 번호로 SMS를 전송합니다.')],
  },
  {
    id: 'sendgrid', name: 'SendGrid', category: '메일', auth: 'local',
    description: '이메일 통계 조회 및 이메일 발송', officialSetupUrl: 'https://docs.sendgrid.com/api-reference', webhookKey: 'sendgrid',
    actions: [READ('get_stats', '발송 통계 조회', '이메일 발송 통계를 조회합니다.'), SENSITIVE('send_email', '이메일 발송', '외부 수신자에게 이메일을 전송합니다.')],
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

export const CONNECTED_APP_CATEGORIES = ['전체', '메일', '일정', '파일', '협업', '개발', '검색·생활', '문서·언어', 'CRM·고객', '소셜', '쇼핑·결제', '인프라', '자동화'] as const;
