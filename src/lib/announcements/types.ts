export type AnnouncementTopic='climate'|'trade'|'immigration';
export interface OfficialAnnouncement {
 id:string;sourceId:string;sourceName:string;country:string;topic:AnnouncementTopic;
 title:string;url:string;publishedAt:string;datePrecision:'day'|'timestamp';dateKind:'published'|'updated';language:string;
 kind:'announcement';
}
export interface AnnouncementSource {
 id:string;name:string;url:string;countries:string[];topic:AnnouncementTopic|'auto';
 language:string;format:'rss'|'miti-annual';year?:number;legacyFeedKey?:string;
 /** Exact additional article hosts when the official feed uses a separate delivery host. */
 allowedArticleHosts?:string[];
 /** Restrict a mixed-language official feed to its canonical article path. */
 articlePathPrefix?:string;
 /** Gazette feeds timestamp a publication day at local midnight; show its source day. */
 publicationDayTimeZone?:string;
 /** Feed dates include a calendar day but no timezone; preserve that day without inventing a clock time. */
 publicationDayFromFeed?:boolean;
 /** Source-specific routine notices are omitted before title-topic classification. */
 excludeTitle?:RegExp;
 /** Positive topic filter for a fixed-topic feed that also carries operational notices. */
 includeTitle?:RegExp;
}
export interface AnnouncementSourceResult {
 sourceId:string;name:string;url:string;status:'available'|'retained'|'unavailable';
 fetchedAt:string|null;checkedAt:string;records:number;problem:string|null;
}
export interface AnnouncementBundle {country:string;checkedAt:string;items:OfficialAnnouncement[];sources:AnnouncementSourceResult[]}
