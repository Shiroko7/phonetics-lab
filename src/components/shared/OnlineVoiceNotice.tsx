import { onlineVoiceStatus, refreshOnlineVoices } from '../../lib/speech.ts'

/** Parents already subscribe to voice changes, including discovery status. */
export function OnlineVoiceNotice() {
  const status = onlineVoiceStatus()
  return <div className="online-voice-notice">
    <p>Free online voices use Microsoft’s Edge speech service through the local app service. No account, API key, or payment is needed.</p>
    <p>Only the text you ask to hear is sent for speech generation. Your recordings are not sent to this voice service.</p>
    <div role="status">{status.message}</div>
    <button className="ghost small" onClick={() => void refreshOnlineVoices()} disabled={status.phase === 'loading'}>
      {status.phase === 'loading' ? 'Loading voices…' : 'Refresh online voices'}
    </button>
  </div>
}
