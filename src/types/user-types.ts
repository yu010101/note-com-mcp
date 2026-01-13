export interface NoteUser {
  id?: string;
  nickname?: string;
  urlname?: string;
  bio?: string;
  profile?: {
    bio?: string;
  };
  followersCount?: number;
  followingCount?: number;
  notesCount?: number;
  magazinesCount?: number;
  followerCount?: number; // APIレスポンスで単数形が使われる場合
  noteCount?: number; // APIレスポンスで単数形が使われる場合
  magazineCount?: number; // APIレスポンスで単数形が使われる場合
  profileImageUrl?: string;
  user_profile_image_path?: string;
  twitter_nickname?: string;
  is_official?: boolean;
  custom_domain?: string;
  like_appeal_text?: string;
  like_appeal_image?: string;
  follow_appeal_text?: string;
  name?: string;
}

export interface FormattedUser {
  id: string;
  nickname: string;
  urlname: string;
  bio: string;
  followersCount: number;
  followingCount: number;
  notesCount: number;
  magazinesCount?: number;
  url: string;
  profileImageUrl?: string;
}
