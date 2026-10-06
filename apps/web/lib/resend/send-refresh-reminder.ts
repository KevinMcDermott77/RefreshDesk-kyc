import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY)

export type DueClient = {
  client_id: string
  display_name: string
  client_type: string
  risk_rating: string
  refresh_due_date: string
}

export type FirmDigest = {
  firm_id: string
  firm_name: string
  supervisor_name: string
  supervisor_email: string
  clients: DueClient[]
}

function buildEmailHtml(digest: FirmDigest): string {
  const rows = digest.clients
    .map((c) => {
      const due = new Date(c.refresh_due_date).toLocaleDateString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      })
      return `
        <tr>
          <td style="padding:6px 10px;border-bottom:1px solid #f1f5f9;">${c.display_name}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #f1f5f9;text-transform:capitalize;">${c.client_type}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #f1f5f9;text-transform:capitalize;">${c.risk_rating}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #f1f5f9;">${due}</td>
        </tr>`
    })
    .join('')

  const appUrl = process.env.APP_URL ?? 'https://your-domain.com'

  return `<!DOCTYPE html>
<html>
<body style="font-family:system-ui,-apple-system,sans-serif;font-size:14px;color:#1e293b;max-width:640px;margin:0 auto;padding:32px 24px;">
  <p>Hi ${digest.supervisor_name},</p>
  <p>The following clients at <strong>${digest.firm_name}</strong> have KYC refreshes due within the next 30 days:</p>
  <table style="width:100%;border-collapse:collapse;margin:20px 0;font-size:13px;">
    <thead>
      <tr style="background:#f8fafc;text-align:left;">
        <th style="padding:8px 10px;font-weight:600;border-bottom:2px solid #e2e8f0;">Client</th>
        <th style="padding:8px 10px;font-weight:600;border-bottom:2px solid #e2e8f0;">Type</th>
        <th style="padding:8px 10px;font-weight:600;border-bottom:2px solid #e2e8f0;">Risk</th>
        <th style="padding:8px 10px;font-weight:600;border-bottom:2px solid #e2e8f0;">Due date</th>
      </tr>
    </thead>
    <tbody>
      ${rows}
    </tbody>
  </table>
  <p>
    <a href="${appUrl}/dashboard/clients?filter=due_soon" style="color:#0f766e;font-weight:600;">
      Log in to RefreshDesk to action these
    </a>
  </p>
  <hr style="border:none;border-top:1px solid #e2e8f0;margin:28px 0;" />
  <p style="font-size:12px;color:#64748b;margin:0;">
    This is an automated reminder from RefreshDesk.<br />
    You are receiving this because you are the designated MLR supervisor for ${digest.firm_name}.
  </p>
</body>
</html>`
}

export async function sendRefreshReminder(digest: FirmDigest): Promise<void> {
  const n = digest.clients.length
  const plural = n === 1 ? '' : 's'
  const subject = `[RefreshDesk] ${n} client refresh${plural} due within 30 days — ${digest.firm_name}`

  await resend.emails.send({
    from: 'RefreshDesk <onboarding@resend.dev>',
    to: digest.supervisor_email,
    subject,
    html: buildEmailHtml(digest),
  })
}
