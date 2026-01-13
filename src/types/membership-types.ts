export interface Membership {
  id?: string;
  key?: string;
  name?: string;
  description?: string;
  creatorId?: string;
  creatorName?: string;
  creatorUrlname?: string;
  price?: number;
  memberCount?: number;
  notesCount?: number;
}

export interface MembershipSummary {
  id?: string;
  key?: string;
  name?: string;
  urlname?: string;
  price?: number;
  description?: string;
  headerImagePath?: string;
  creator?: {
    id?: string;
    nickname?: string;
    urlname?: string;
    profileImageUrl?: string;
  };
  plans?: string[];
  joinedAt?: string;
}

export interface MembershipPlan {
  id?: string;
  key?: string;
  name?: string;
  description?: string;
  price?: number;
  memberCount?: number;
  notesCount?: number;
  status?: string;
  ownerName?: string;
  headerImagePath?: string;
  plans?: string[];
  url?: string;
}

export interface FormattedMembershipNote {
  id: string;
  title: string;
  excerpt: string;
  publishedAt: string;
  likesCount: number;
  commentsCount: number;
  user:
    | string
    | {
        id?: string;
        nickname?: string;
        urlname?: string;
      };
  url: string;
  isMembersOnly: boolean;
}
