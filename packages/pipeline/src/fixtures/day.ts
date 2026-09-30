// A small real-shaped day: three articles, two events. Bodies are long enough to be cited from.
export const FEED_XML = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><title>Fixture wire</title>
<item><title>Treasury proposes rules on partnership basis shifting</title><link>https://fixture.test/treasury-basis</link><pubDate>Thu, 04 Sep 2026 15:10:00 GMT</pubDate>
<description>Treasury and the IRS proposed regulations targeting basis-shifting transactions among related partners.</description>
<content:encoded><![CDATA[<p>Treasury and the IRS proposed regulations targeting basis-shifting transactions among related partners. The proposed rules would require partnerships to report certain basis adjustments under section 734 and section 743 on a new form. Comments are due 60 days after publication in the Federal Register. The agencies estimated the rules would affect about 4,000 partnerships a year, most of them with assets above 100 million dollars. A Treasury official said the rules close a gap that let related parties shift basis to depreciable assets without an economic change.</p>]]></content:encoded></item>
<item><title>Journal: basis shifting rules land after two years of notices</title><link>https://fixture.test/journal-basis</link><pubDate>Thu, 04 Sep 2026 18:40:00 GMT</pubDate>
<description>Practitioners reacted to the proposed basis-shifting regulations.</description>
<content:encoded><![CDATA[<p>Practitioners reacted to the proposed basis-shifting regulations released Wednesday. Several said the reporting burden would fall on mid-size partnerships that never used the transactions. The proposal follows guidance issued in June 2024 that flagged the transactions as listed. One adviser said clients with related-party partnerships should review 2025 basis adjustments before the rules are finalized.</p>]]></content:encoded></item>
<item><title>Chipmaker breaks ground on Arizona packaging plant</title><link>https://fixture.test/chip-plant</link><pubDate>Thu, 04 Sep 2026 20:05:00 GMT</pubDate>
<description>A chipmaker began construction of an advanced packaging plant in Arizona.</description>
<content:encoded><![CDATA[<p>A chipmaker began construction of an advanced packaging plant in Arizona on Wednesday. The company said the plant represents 6.5 billion dollars of investment and will employ about 1,500 people when it opens in 2028. State officials said the project qualifies for accelerated depreciation under a program enacted last year. Construction is expected to take three years.</p>]]></content:encoded></item>
</channel></rss>`;

export const PROFILE_YAML = `id: r01
email: reader@example.test
timezone: America/New_York
deliveryHour: 6
topics:
  - { name: partnership tax, weight: 5 }
  - { name: fixed assets and depreciation, weight: 4 }
muted:
  - sports
stake:
  - Works in multi-entity tax at a manufacturer with related-party partnerships.
  - Manages a fixed-asset register.
`;
