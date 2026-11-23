-- Apply platform margins to video pricing:
--   per-second models: upstream + $0.10/second
--   per-request models: upstream + $0.20/request
-- Write the final user-facing price into both channel pricing and the video group
-- model pricing so real invocations always have a price.
DO $migration$
DECLARE
    target_channel_id bigint;
    current_video_group_id bigint;
    group_pricing_json jsonb := $catalog$[
  {
    "models": [
      "grok-imagine-video"
    ],
    "platform": "composite",
    "intervals": [
      {
        "min_tokens": 0,
        "max_tokens": null,
        "tier_label": "480p",
        "per_request_price": 0.16,
        "sort_order": 0
      },
      {
        "min_tokens": 0,
        "max_tokens": null,
        "tier_label": "720p",
        "per_request_price": 0.16,
        "sort_order": 1
      }
    ],
    "billing_mode": "video",
    "per_request_price": 0.16
  },
  {
    "models": [
      "grok-imagine-video-1.5"
    ],
    "platform": "composite",
    "intervals": [
      {
        "min_tokens": 0,
        "max_tokens": null,
        "tier_label": "480p",
        "per_request_price": 0.2,
        "sort_order": 0
      },
      {
        "min_tokens": 0,
        "max_tokens": null,
        "tier_label": "720p",
        "per_request_price": 0.2,
        "sort_order": 1
      },
      {
        "min_tokens": 0,
        "max_tokens": null,
        "tier_label": "1080p",
        "per_request_price": 0.22,
        "sort_order": 2
      }
    ],
    "billing_mode": "video",
    "per_request_price": 0.2
  },
  {
    "models": [
      "minimax H3"
    ],
    "platform": "composite",
    "intervals": [
      {
        "min_tokens": 0,
        "max_tokens": null,
        "tier_label": "480p",
        "per_request_price": 0.14,
        "sort_order": 0
      }
    ],
    "billing_mode": "video",
    "per_request_price": 0.14
  },
  {
    "models": [
      "minimax H3-self"
    ],
    "platform": "composite",
    "intervals": [
      {
        "min_tokens": 0,
        "max_tokens": null,
        "tier_label": "480p",
        "per_request_price": 0.16,
        "sort_order": 0
      },
      {
        "min_tokens": 0,
        "max_tokens": null,
        "tier_label": "768p",
        "per_request_price": 0.16,
        "sort_order": 1
      }
    ],
    "billing_mode": "video",
    "per_request_price": 0.16
  },
  {
    "models": [
      "muse-cheap"
    ],
    "platform": "composite",
    "intervals": [
      {
        "min_tokens": 1,
        "max_tokens": 10,
        "tier_label": "720p-1-10s",
        "per_request_price": 1.12,
        "sort_order": 0
      },
      {
        "min_tokens": 0,
        "max_tokens": 20,
        "tier_label": "720p-20s",
        "per_request_price": 1.69,
        "sort_order": 1
      },
      {
        "min_tokens": 0,
        "max_tokens": 30,
        "tier_label": "720p-30s",
        "per_request_price": 1.92,
        "sort_order": 2
      }
    ],
    "billing_mode": "per_request",
    "per_request_price": 1.12
  },
  {
    "models": [
      "muse-video"
    ],
    "platform": "composite",
    "intervals": [
      {
        "min_tokens": 0,
        "max_tokens": null,
        "tier_label": "720p",
        "per_request_price": 0.13,
        "sort_order": 0
      }
    ],
    "billing_mode": "video",
    "per_request_price": 0.13
  },
  {
    "models": [
      "seedance 2.0 fast-GT"
    ],
    "platform": "composite",
    "intervals": [
      {
        "min_tokens": 0,
        "max_tokens": 10,
        "tier_label": "480p-10s",
        "per_request_price": 2.25,
        "sort_order": 0
      },
      {
        "min_tokens": 0,
        "max_tokens": 15,
        "tier_label": "480p-15s",
        "per_request_price": 3.26,
        "sort_order": 1
      },
      {
        "min_tokens": 0,
        "max_tokens": 10,
        "tier_label": "720p-10s",
        "per_request_price": 4.61,
        "sort_order": 2
      },
      {
        "min_tokens": 0,
        "max_tokens": 15,
        "tier_label": "720p-15s",
        "per_request_price": 6.81,
        "sort_order": 3
      }
    ],
    "billing_mode": "per_request",
    "per_request_price": 2.25
  },
  {
    "models": [
      "seedance 2.0 mini-GT"
    ],
    "platform": "composite",
    "intervals": [
      {
        "min_tokens": 0,
        "max_tokens": 10,
        "tier_label": "480p-10s",
        "per_request_price": 1.12,
        "sort_order": 0
      },
      {
        "min_tokens": 0,
        "max_tokens": 15,
        "tier_label": "480p-15s",
        "per_request_price": 1.58,
        "sort_order": 1
      },
      {
        "min_tokens": 0,
        "max_tokens": 10,
        "tier_label": "720p-10s",
        "per_request_price": 2.18,
        "sort_order": 2
      },
      {
        "min_tokens": 0,
        "max_tokens": 15,
        "tier_label": "720p-15s",
        "per_request_price": 3.17,
        "sort_order": 3
      }
    ],
    "billing_mode": "per_request",
    "per_request_price": 1.12
  },
  {
    "models": [
      "seedance 2.5-GT"
    ],
    "platform": "composite",
    "intervals": [
      {
        "min_tokens": 0,
        "max_tokens": null,
        "tier_label": "480p",
        "per_request_price": 0.98,
        "sort_order": 0
      },
      {
        "min_tokens": 0,
        "max_tokens": null,
        "tier_label": "720p",
        "per_request_price": 1.77,
        "sort_order": 1
      },
      {
        "min_tokens": 0,
        "max_tokens": null,
        "tier_label": "1080p",
        "per_request_price": 3.85,
        "sort_order": 2
      }
    ],
    "billing_mode": "video",
    "per_request_price": 0.98
  },
  {
    "models": [
      "seedance-2.0"
    ],
    "platform": "composite",
    "intervals": [
      {
        "min_tokens": 0,
        "max_tokens": null,
        "tier_label": "480p",
        "per_request_price": 0.57,
        "sort_order": 0
      },
      {
        "min_tokens": 0,
        "max_tokens": null,
        "tier_label": "720p",
        "per_request_price": 0.7,
        "sort_order": 1
      }
    ],
    "billing_mode": "video",
    "per_request_price": 0.57
  },
  {
    "models": [
      "seedance-2.0-fast"
    ],
    "platform": "composite",
    "intervals": [
      {
        "min_tokens": 0,
        "max_tokens": null,
        "tier_label": "480p",
        "per_request_price": 0.3,
        "sort_order": 0
      },
      {
        "min_tokens": 0,
        "max_tokens": null,
        "tier_label": "720p",
        "per_request_price": 0.52,
        "sort_order": 1
      }
    ],
    "billing_mode": "video",
    "per_request_price": 0.3
  },
  {
    "models": [
      "seedance-2.0-mini"
    ],
    "platform": "composite",
    "intervals": [
      {
        "min_tokens": 0,
        "max_tokens": null,
        "tier_label": "480p",
        "per_request_price": 0.22,
        "sort_order": 0
      },
      {
        "min_tokens": 0,
        "max_tokens": null,
        "tier_label": "720p",
        "per_request_price": 0.32,
        "sort_order": 1
      }
    ],
    "billing_mode": "video",
    "per_request_price": 0.22
  },
  {
    "models": [
      "seedance-2.0-mini-Chovy"
    ],
    "platform": "composite",
    "intervals": [
      {
        "min_tokens": 0,
        "max_tokens": 5,
        "tier_label": "720p-5s",
        "per_request_price": 1.7,
        "sort_order": 0
      },
      {
        "min_tokens": 0,
        "max_tokens": 10,
        "tier_label": "720p-10s",
        "per_request_price": 1.7,
        "sort_order": 1
      },
      {
        "min_tokens": 0,
        "max_tokens": 15,
        "tier_label": "720p-15s",
        "per_request_price": 1.7,
        "sort_order": 2
      }
    ],
    "billing_mode": "per_request",
    "per_request_price": 1.7
  },
  {
    "models": [
      "seedance-2.5"
    ],
    "platform": "composite",
    "intervals": [
      {
        "min_tokens": 0,
        "max_tokens": null,
        "tier_label": "480p",
        "per_request_price": 0.67,
        "sort_order": 0
      },
      {
        "min_tokens": 0,
        "max_tokens": null,
        "tier_label": "720p",
        "per_request_price": 0.99,
        "sort_order": 1
      }
    ],
    "billing_mode": "video",
    "per_request_price": 0.67
  },
  {
    "models": [
      "seedance-2.5-alioth"
    ],
    "platform": "composite",
    "intervals": [
      {
        "min_tokens": 0,
        "max_tokens": null,
        "tier_label": "720p",
        "per_request_price": 0.5,
        "sort_order": 0
      }
    ],
    "billing_mode": "video",
    "per_request_price": 0.5
  },
  {
    "models": [
      "seedance-2.5-draft-zq"
    ],
    "platform": "composite",
    "intervals": [
      {
        "min_tokens": 0,
        "max_tokens": null,
        "tier_label": "480p",
        "per_request_price": 0.46,
        "sort_order": 0
      }
    ],
    "billing_mode": "video",
    "per_request_price": 0.46
  },
  {
    "models": [
      "seedance-2.5-flash-zq"
    ],
    "platform": "composite",
    "intervals": [
      {
        "min_tokens": 0,
        "max_tokens": null,
        "tier_label": "480p",
        "per_request_price": 0.38,
        "sort_order": 0
      },
      {
        "min_tokens": 0,
        "max_tokens": null,
        "tier_label": "720p",
        "per_request_price": 0.86,
        "sort_order": 1
      }
    ],
    "billing_mode": "video",
    "per_request_price": 0.38
  },
  {
    "models": [
      "seedance-2.5-merak"
    ],
    "platform": "composite",
    "intervals": [
      {
        "min_tokens": 0,
        "max_tokens": null,
        "tier_label": "480p",
        "per_request_price": 7.45,
        "sort_order": 0
      },
      {
        "min_tokens": 0,
        "max_tokens": null,
        "tier_label": "720p",
        "per_request_price": 7.45,
        "sort_order": 1
      }
    ],
    "billing_mode": "per_request",
    "per_request_price": 7.45
  },
  {
    "models": [
      "seedance2.0 fast Deneb"
    ],
    "platform": "composite",
    "intervals": [
      {
        "min_tokens": 0,
        "max_tokens": 5,
        "tier_label": "720p-5s",
        "per_request_price": 1.58,
        "sort_order": 0
      },
      {
        "min_tokens": 0,
        "max_tokens": 10,
        "tier_label": "720p-10s",
        "per_request_price": 1.58,
        "sort_order": 1
      },
      {
        "min_tokens": 0,
        "max_tokens": 15,
        "tier_label": "720p-15s",
        "per_request_price": 1.58,
        "sort_order": 2
      }
    ],
    "billing_mode": "per_request",
    "per_request_price": 1.58
  },
  {
    "models": [
      "seedance2.0 mini Love"
    ],
    "platform": "composite",
    "intervals": [
      {
        "min_tokens": 0,
        "max_tokens": null,
        "tier_label": "480p",
        "per_request_price": 0.22,
        "sort_order": 0
      },
      {
        "min_tokens": 0,
        "max_tokens": null,
        "tier_label": "720p",
        "per_request_price": 0.33,
        "sort_order": 1
      }
    ],
    "billing_mode": "video",
    "per_request_price": 0.22
  },
  {
    "models": [
      "seedance2.5 coke"
    ],
    "platform": "composite",
    "intervals": [
      {
        "min_tokens": 0,
        "max_tokens": null,
        "tier_label": "720p",
        "per_request_price": 8.25,
        "sort_order": 0
      }
    ],
    "billing_mode": "per_request",
    "per_request_price": 8.25
  },
  {
    "models": [
      "wan3.0-video"
    ],
    "platform": "composite",
    "intervals": [
      {
        "min_tokens": 0,
        "max_tokens": null,
        "tier_label": "480p",
        "per_request_price": 0.52,
        "sort_order": 0
      },
      {
        "min_tokens": 0,
        "max_tokens": null,
        "tier_label": "720p",
        "per_request_price": 0.9,
        "sort_order": 1
      },
      {
        "min_tokens": 0,
        "max_tokens": null,
        "tier_label": "1080p",
        "per_request_price": 1.62,
        "sort_order": 2
      }
    ],
    "billing_mode": "video",
    "per_request_price": 0.52
  },
  {
    "models": [
      "wan3.0-yuanlian"
    ],
    "platform": "composite",
    "intervals": [
      {
        "min_tokens": 0,
        "max_tokens": null,
        "tier_label": "480p",
        "per_request_price": 0.28,
        "sort_order": 0
      },
      {
        "min_tokens": 0,
        "max_tokens": null,
        "tier_label": "720p",
        "per_request_price": 0.46,
        "sort_order": 1
      },
      {
        "min_tokens": 0,
        "max_tokens": null,
        "tier_label": "1080p",
        "per_request_price": 0.78,
        "sort_order": 2
      }
    ],
    "billing_mode": "video",
    "per_request_price": 0.28
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

    SELECT id INTO current_video_group_id
    FROM groups
    WHERE name = '视频' AND status = 'active' AND deleted_at IS NULL
    ORDER BY id DESC
    LIMIT 1;

    IF current_video_group_id IS NOT NULL THEN
        UPDATE groups
        SET model_pricing = group_pricing_json,
            updated_at = NOW()
        WHERE id = current_video_group_id;
    END IF;

    UPDATE channel_model_pricing
    SET per_request_price = CASE
            WHEN billing_mode = 'video' AND per_request_price IS NOT NULL THEN per_request_price + 0.10
            WHEN billing_mode = 'per_request' AND per_request_price IS NOT NULL THEN per_request_price + 0.20
            ELSE per_request_price
        END,
        updated_at = NOW()
    WHERE channel_id = target_channel_id;

    UPDATE channel_pricing_intervals AS interval
    SET per_request_price = CASE
            WHEN pricing.billing_mode = 'video' AND interval.per_request_price IS NOT NULL THEN interval.per_request_price + 0.10
            WHEN pricing.billing_mode = 'per_request' AND interval.per_request_price IS NOT NULL THEN interval.per_request_price + 0.20
            ELSE interval.per_request_price
        END,
        updated_at = NOW()
    FROM channel_model_pricing AS pricing
    WHERE interval.pricing_id = pricing.id
      AND pricing.channel_id = target_channel_id;

    UPDATE channel_model_pricing
    SET description = '480p 有声视频，4–15 秒；支持文生视频和 9 张参考图；第 6–9 张参考图每张加收 $0.18。',
        updated_at = NOW()
    WHERE channel_id = target_channel_id
      AND EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(models) AS model_name
          WHERE lower(model_name) = lower('minimax H3')
      );

    UPDATE channel_model_pricing
    SET description = '渠道来源：Muse；720p 有声视频；支持 1–10 秒、20 秒和 30 秒；支持 7 张参考图。',
        updated_at = NOW()
    WHERE channel_id = target_channel_id
      AND EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(models) AS model_name
          WHERE lower(model_name) = lower('muse-cheap')
      );
END
$migration$;
