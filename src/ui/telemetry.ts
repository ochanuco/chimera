// PostHog telemetry の埋め込み JS (docs/ui.md "Telemetry")。GET /assets/telemetry.js
// (src/routes/assets.ts) が POSTHOG_KEY の有無でこの2つを出し分ける。

// PostHog 公式の array.js ローダ snippet（https://posthog.com/docs/libraries/js
// の HTML snippet installation code を verbatim で再現）。posthog.init が呼ばれる前の
// capture 等の呼び出しをキューする stub を window.posthog に仕込み、実体
// (array.js) を非同期で読み込む。
const POSTHOG_LOADER_SNIPPET = `!function(t,e){var o,n,p,r;e.__SV||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement("script")).type="text/javascript",p.crossOrigin="anonymous",p.async=!0,p.src=s.api_host.replace(".i.posthog.com","-assets.i.posthog.com")+"/static/array.js",(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],Object.defineProperty(u,"toString",{configurable:!0,enumerable:!0,writable:!0,value:function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e}}),Object.defineProperty(u.people,"toString",{configurable:!0,enumerable:!0,writable:!0,value:function(){return u.toString(1)+".people (stub)"}}),o="init capture register register_once register_for_session unregister unregister_for_session getFeatureFlag getFeatureFlagResult isFeatureEnabled reloadFeatureFlags updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures on onFeatureFlags onSessionId getSurveys getActiveMatchingSurveys renderSurvey canRenderSurvey getNextSurveyStep identify setPersonProperties group resetGroups setPersonPropertiesForFlags resetPersonPropertiesForFlags setGroupPropertiesForFlags resetGroupPropertiesForFlags reset get_distinct_id getGroups get_session_id get_session_replay_url alias set_config startSessionRecording stopSessionRecording sessionRecordingStarted captureException loadToolbar get_property getSessionProperty createPersonProfile opt_in_capturing opt_out_capturing has_opted_in_capturing has_opted_out_capturing clear_opt_in_out_capturing debug".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);`;

export function telemetryJs(opts: { key: string; host: string; distinctId: string | null }): string {
  const initOptions = {
    api_host: opts.host,
    person_profiles: 'identified_only',
    capture_pageview: true,
    capture_pageleave: true,
    autocapture: true,
  };
  let js = `${POSTHOG_LOADER_SNIPPET}\nposthog.init(${JSON.stringify(opts.key)}, ${JSON.stringify(initOptions)});\n`;
  if (opts.distinctId !== null) {
    js += `posthog.identify(${JSON.stringify(opts.distinctId)});\n`;
  }
  return js;
}

export const telemetryDisabledJs = '// telemetry disabled (POSTHOG_KEY is not set)\n';
