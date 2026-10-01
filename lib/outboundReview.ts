export type ReviewProspect = {
  id: string;
  email: string;
  company: string;
  website: string;
  subject: string;
  bodyText: string;
};

export type ReviewCampaignConfig = {
  name: string;
  mailboxId: number;
  timezone: string;
  postalAddress: string;
  prospects: ReviewProspect[];
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function plainTextToHtml(value: string): string {
  return escapeHtml(value.trim()).replace(/\r?\n/g, "<br />");
}

export function reviewBatchName(ids: string[]): string {
  const normalized = [...new Set(ids.map((id) => id.trim()).filter(Boolean))].sort();
  return `Prospect OS Review · ${normalized.join(" · ")}`;
}

export function buildCampaignPayload(config: ReviewCampaignConfig) {
  const delivery = [{ from: "08:00", to: "17:00" }];
  const postalAddress = escapeHtml(config.postalAddress.trim());
  return {
    name: config.name,
    email_account_ids: [config.mailboxId],
    settings: {
      timezone: config.timezone,
      prospect_timezone: false,
      daily_enroll: Math.max(1, config.prospects.length),
      gdpr_unsubscribe: true,
      list_unsubscribe: true,
      auto_pause_prospect_from_domain_statuses: ["REPLIED", "BOUNCED"],
      catch_all_verification_mode: "ONLY_VERIFY",
      count_followup_delay_in_working_days: true,
    },
    steps: {
      type: "START",
      followup: {
        type: "EMAIL",
        delivery_time: {
          MONDAY: delivery,
          TUESDAY: delivery,
          WEDNESDAY: delivery,
          THURSDAY: delivery,
          FRIDAY: delivery,
        },
        body: {
          versions: [{
            subject: "{{SNIPPET_1}}",
            message:
              '<div>{{SNIPPET_2}}</div>' +
              '<div><br /></div>' +
              '<div style="font-size:11px;line-height:1.4">' +
              'Business outreach from Mark Krizsan.<br />' +
              postalAddress +
              '<br /><a href="{{UNSUBSCRIBE}}">Unsubscribe</a></div>',
            signature: "SENDER",
            track_opens: false,
          }],
        },
        followup: null,
      },
    },
  };
}

export function buildProspectImport(campaignId: number, prospects: ReviewProspect[], batchName: string) {
  return {
    campaign: { campaign_id: campaignId },
    force: false,
    file_name: batchName,
    prospects: prospects.map((prospect) => ({
      email: prospect.email,
      status: "ACTIVE",
      company: prospect.company,
      website: prospect.website,
      tags: `#PROSPECT_OS #${prospect.id.replace(/[^A-Za-z0-9]/g, "")}`,
      snippet1: prospect.subject,
      snippet2: plainTextToHtml(prospect.bodyText),
      snippet3: prospect.id,
    })),
  };
}

export function reviewBatchKey(prospects: ReviewProspect[]): string {
  return reviewBatchName(prospects.map((prospect) => prospect.id));
}
