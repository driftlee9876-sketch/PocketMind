import {chatIntegrationRequest} from '../src/integrationActions';
import {integrationReply} from '../src/integrationPresentation';

test('explicit Korean chat reads use only the selected integration', () => {
  expect(chatIntegrationRequest('최근 메일 보여줘')).toMatchObject({id:'google-gmail', input:{query:'in:inbox'}});
  expect(chatIntegrationRequest('안 읽은 메일 보여줘')).toMatchObject({input:{query:'is:unread'}});
  expect(chatIntegrationRequest('드라이브에서 보고서 찾아줘')).toMatchObject({id:'google-drive', input:{query:'보고서'}});
  expect(chatIntegrationRequest('@Gmail 메일 발송')).toMatchObject({action:'form', operation:'send_message'});
  expect(chatIntegrationRequest('@Google Drive')).toMatchObject({action:'menu', id:'google-drive'});
  expect(chatIntegrationRequest('드라이브 파일 삭제해줘')).toBeNull();
  expect(chatIntegrationRequest('메일 설정을 설명해줘')).toBeNull();
});
test('mail and file results render without internal identifiers', () => {
  const reply = {actionId:'1', integrationId:'google-gmail', action:'search_messages', risk:'read' as const, status:'completed' as const};
  const body = integrationReply({...reply,result:JSON.stringify([{id:'private-id',subject:'회의 안내',from:'담당자',snippet:'내일 만나요.'}])});
  expect(body).toContain('1. 회의 안내\n담당자\n내일 만나요.');
  expect(body).not.toContain('private-id');
  expect(integrationReply({...reply,result:'{"files":[]}'})).toContain('결과가 없어요');
});
