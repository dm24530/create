-- Replace imported video descriptions with concise, fully visible Chinese copy.
DO $migration$
DECLARE
    target_channel_id bigint;
    entry jsonb;
    descriptions jsonb := $catalog$[
  {
    "model_name": "grok-imagine-video",
    "description": "文生/图生视频，480p/720p，按秒计费；支持首帧和参考图。"
  },
  {
    "model_name": "grok-imagine-video-1.5",
    "description": "文生/图生视频，480p/720p/1080p，按秒计费；支持首尾帧和参考图。"
  },
  {
    "model_name": "minimax H3",
    "description": "480p 有声视频，4–15 秒；支持文生视频和 9 张参考图；第 6–9 张参考图每张加收 ¥0.18。"
  },
  {
    "model_name": "minimax H3-self",
    "description": "渠道来源：自部署；480p/768p，1–15 秒；支持 9 张参考图和 3 段参考音频。"
  },
  {
    "model_name": "muse-cheap",
    "description": "渠道来源：Muse；720p 有声视频；1–10 秒 ¥0.92、20 秒 ¥1.49、30 秒 ¥1.72；支持 7 张参考图。"
  },
  {
    "model_name": "muse-video",
    "description": "渠道来源：Muse；720p，1–60 秒，成片带音轨；支持首帧和最多 4 张参考图。"
  },
  {
    "model_name": "seedance 2.0 fast-GT",
    "description": "渠道来源：官方链路；480p/720p，仅 10 秒或 15 秒；支持参考图、参考视频和参考音频；有无参考视频按对应档位计价。"
  },
  {
    "model_name": "seedance 2.0 mini-GT",
    "description": "渠道来源：官方链路；480p/720p，仅 10 秒或 15 秒；参考视频与成片时长共同计费，提交时预扣、完成后多退少补。"
  },
  {
    "model_name": "seedance 2.5-GT",
    "description": "480p/720p/1080p，4–30 秒；支持 30 张参考图、10 段参考视频和 10 段参考音频；含参考视频时按较高价计费。"
  },
  {
    "model_name": "seedance-2.0",
    "description": "480p/720p，5–15 秒；支持 9 张参考图、3 段参考视频和 3 段参考音频。"
  },
  {
    "model_name": "seedance-2.0-fast",
    "description": "480p/720p，5–15 秒；支持 9 张参考图、1 段参考视频和 10 段参考音频。"
  },
  {
    "model_name": "seedance-2.0-mini",
    "description": "480p/720p，5–15 秒；支持 9 张参考图、3 段参考视频和 3 段参考音频。"
  },
  {
    "model_name": "seedance-2.0-mini-Chovy",
    "description": "固定 720p，5/10/15 秒同价；支持 9 张参考图，不支持参考视频和参考音频。"
  },
  {
    "model_name": "seedance-2.5",
    "description": "480p/720p，5–30 秒；支持 30 张参考图、10 段参考视频和 10 段参考音频。"
  },
  {
    "model_name": "seedance-2.5-alioth",
    "description": "固定 720p，4–30 秒；支持 30 张参考图和 10 段参考音频。"
  },
  {
    "model_name": "seedance-2.5-draft-zq",
    "description": "480p，4–30 秒；支持 30 张参考图、10 段参考视频和 10 段参考音频；含参考视频按较高价计费。"
  },
  {
    "model_name": "seedance-2.5-flash-zq",
    "description": "480p/720p，4–30 秒；支持 10 张参考图、5 段参考视频和 5 段参考音频；含参考视频按较高价计费。"
  },
  {
    "model_name": "seedance-2.5-merak",
    "description": "480p/720p，4–30 秒；支持 10 张参考图和 5 段参考音频。"
  },
  {
    "model_name": "seedance2.0 fast Deneb",
    "description": "固定 720p，5/10/15 秒同价；支持 9 张参考图。"
  },
  {
    "model_name": "seedance2.0 mini Love",
    "description": "480p/720p，4–15 秒；支持 9 张参考图和 3 段参考音频；画面可能出现台词字幕。"
  },
  {
    "model_name": "seedance2.5 coke",
    "description": "固定 720p，5–30 秒；支持 30 张参考图、10 段参考视频和 10 段参考音频。"
  },
  {
    "model_name": "wan3.0-video",
    "description": "480p/720p/1080p，2–30 秒；支持 10 张参考图和 5 段参考音频。"
  },
  {
    "model_name": "wan3.0-yuanlian",
    "description": "结果来源：官方链接；480p/720p/1080p，2–30 秒；支持 10 张参考图、5 段参考视频和 5 段参考音频；返回官方视频链接。"
  }
]$catalog$::jsonb;
BEGIN
    SELECT id INTO target_channel_id
    FROM channels
    WHERE name = '视频' AND status = 'active'
    ORDER BY id
    LIMIT 1;

    IF target_channel_id IS NULL THEN
        RETURN;
    END IF;

    FOR entry IN SELECT * FROM jsonb_array_elements(descriptions)
    LOOP
        UPDATE channel_model_pricing p
        SET description = entry->>'description',
            updated_at = NOW()
        WHERE p.channel_id = target_channel_id
          AND EXISTS (
              SELECT 1
              FROM jsonb_array_elements_text(p.models) AS model_name
              WHERE lower(model_name) = lower(entry->>'model_name')
          );
    END LOOP;
END
$migration$;
