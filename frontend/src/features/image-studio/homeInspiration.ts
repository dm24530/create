import type { InspirationLibraryItem } from '../video-studio/videoArchiveApi'

const base = {
  type: 'image' as const,
  model: 'home-interior-template',
  category: '家居空间',
  width: 1536,
  height: 1024,
  duration_seconds: 0,
  aspect_ratio: '3:2',
  resolution: '2K',
  likes: 0,
  views: 0,
  author: 'Create',
  author_handle: 'create',
  source_url: '',
  has_cover: true,
}

// Curated interior references for the majority of Create's home-decor users.
// They live in the app so the library remains useful when the remote source is
// unavailable or does not contain enough interior content.
export const HOME_INSPIRATION_ITEMS: InspirationLibraryItem[] = [
  {
    ...base,
    id: 'home-living-room-warm-minimal',
    title: '暖调极简客厅',
    prompt: 'A warm minimalist living room with a low linen sofa, travertine coffee table, oak flooring and a large window with sheer curtains. Soft late-afternoon sunlight, cream and sand tones, one sculptural floor lamp, a few art books, calm editorial interior photography, realistic materials, no people, no text, no watermark.',
    cover_url: '/inspiration/home/living-room.jpg',
    source_cover: '/inspiration/home/living-room.jpg',
  },
  {
    ...base,
    id: 'home-living-quiet-luxury',
    title: '安静的高级感起居空间',
    prompt: 'A serene quiet-luxury living room with a low linen sofa, walnut coffee table, warm neutral cushions and soft indirect lighting. A single ceramic vase and dried branches, cream walls, subtle texture, hotel-like calm, realistic interior magazine photography, wide angle, no people, no text.',
    cover_url: '/inspiration/home/quiet-luxury.jpg',
    source_cover: '/inspiration/home/quiet-luxury.jpg',
  },
  {
    ...base,
    id: 'home-kitchen-natural-stone',
    title: '自然石材厨房',
    prompt: 'A refined contemporary kitchen with natural stone countertops, warm oak cabinetry, brushed brass details and a large island. Morning daylight from the side, simple ceramics and a bowl of fruit, lived-in but uncluttered, architectural interior photography, realistic stone texture, no people, no lettering.',
    cover_url: '/inspiration/home/kitchen-interior.jpg',
    source_cover: '/inspiration/home/kitchen-interior.jpg',
  },
  {
    ...base,
    id: 'home-dining-botanical',
    title: '绿植餐厨空间',
    prompt: 'A calm dining area connected to a kitchen, with a round wooden table, sculptural pendant light, linen chairs and abundant indoor greenery near the window. Soft diffused daylight, earthy materials, natural shadows, editorial home decor photography, restrained composition, no people, no text.',
    cover_url: '/inspiration/home/dining.jpg',
    source_cover: '/inspiration/home/dining.jpg',
  },
  {
    ...base,
    id: 'home-soft-living',
    title: '柔和色系起居空间',
    prompt: 'A soft contemporary living room with a cream sectional sofa, woven textures, light wood coffee table, botanical accents and warm natural daylight. Calm neutral palette, airy composition, realistic home decor editorial photography, no people, no text, no watermark.',
    cover_url: '/inspiration/home/bedroom.jpg',
    source_cover: '/inspiration/home/bedroom.jpg',
  },
  {
    ...base,
    id: 'home-bathroom-spa',
    title: '奶油色疗愈卫浴',
    prompt: 'A spa-like bathroom in warm cream tones with microcement walls, a freestanding tub, brushed brass fixtures, folded cotton towels and a small stool with a candle. Diffused daylight, soft shadows, natural stone and wood accents, quiet luxury interior photography, no people, no text.',
    cover_url: '/inspiration/home/bathroom-interior.jpg',
    source_cover: '/inspiration/home/bathroom-interior.jpg',
  },
]
