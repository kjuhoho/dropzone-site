// 백엔드 연결 설정. 비어 있으면 "데모 모드"(이 브라우저에만 저장)로 동작한다.
// Supabase 프로젝트를 만든 뒤 Project URL 과 anon(public) key 를 채운다. (anon key 는 공개해도 되는 키 — RLS 가 보호)
// service_role 키는 절대 여기에 넣지 말 것.
window.DZ_CONFIG = {
  supabaseUrl: "https://zckhdueckqaleafhmkjl.supabase.co",
  supabaseKey: "sb_publishable_KrTLngzV870K5kzoZZKTxw_dK-2dYGl", // publishable(공개용) 키. secret 키는 절대 넣지 않는다
  googleLogin: true,    // Supabase 에서 Google provider 가 켜져 있음
  turnstileSiteKey: "0x4AAAAAAFfBKS-UCchl4tTB", // Cloudflare Turnstile 사이트 키(공개용). 비우면 봇 확인 생략
  contact: "",          // 문의 이메일(선택). 채우면 약관 페이지에 표시
  emailDomain: "dropzone-users.app" // ID 를 내부용 이메일로 바꿀 때 쓰는 가짜 도메인 (실제 메일은 발송되지 않음)
};
