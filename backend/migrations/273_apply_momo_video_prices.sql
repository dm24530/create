-- Apply the 1:1 CNY→USD video prices from momoapi pricing.
-- For conditional reference-video prices, the include-reference-video price is used
-- as the safe billing price; the condition remains documented in the model description.
--
-- Channel pricing is the source of truth for the video group. Remove legacy group-level
-- overrides so every model uses the synchronized per-model intervals.
DO $migration$
DECLARE
    target_channel_id bigint;
    current_video_group_id bigint;
    entry jsonb;
    interval jsonb;
    target_pricing_id bigint;
    catalog_json jsonb := $catalog$[
  {
    "model_name": "grok-imagine-video",
    "billing_mode": "video",
    "base_price": 0.06,
    "intervals": [
      {
        "min_tokens": 0,
        "max_tokens": null,
        "tier_label": "480p",
        "per_request_price": 0.06,
        "sort_order": 0
      },
      {
        "min_tokens": 0,
        "max_tokens": null,
        "tier_label": "720p",
        "per_request_price": 0.06,
        "sort_order": 1
      }
    ]
  },
  {
    "model_name": "grok-imagine-video-1.5",
    "billing_mode": "video",
    "base_price": 0.1,
    "intervals": [
      {
        "min_tokens": 0,
        "max_tokens": null,
        "tier_label": "480p",
        "per_request_price": 0.1,
        "sort_order": 0
      },
      {
        "min_tokens": 0,
        "max_tokens": null,
        "tier_label": "720p",
        "per_request_price": 0.1,
        "sort_order": 1
      },
      {
        "min_tokens": 0,
        "max_tokens": null,
        "tier_label": "1080p",
        "per_request_price": 0.12,
        "sort_order": 2
      }
    ]
  },
  {
    "model_name": "minimax H3",
    "billing_mode": "video",
    "base_price": 0.04,
    "intervals": [
      {
        "min_tokens": 0,
        "max_tokens": null,
        "tier_label": "480p",
        "per_request_price": 0.04,
        "sort_order": 0
      }
    ]
  },
  {
    "model_name": "minimax H3-self",
    "billing_mode": "video",
    "base_price": 0.06,
    "intervals": [
      {
        "min_tokens": 0,
        "max_tokens": null,
        "tier_label": "480p",
        "per_request_price": 0.06,
        "sort_order": 0
      },
      {
        "min_tokens": 0,
        "max_tokens": null,
        "tier_label": "768p",
        "per_request_price": 0.06,
        "sort_order": 1
      }
    ]
  },
  {
    "model_name": "muse-cheap",
    "billing_mode": "per_request",
    "base_price": 0.92,
    "intervals": [
      {
        "min_tokens": 1,
        "max_tokens": 10,
        "tier_label": "720p-1-10s",
        "per_request_price": 0.92,
        "sort_order": 0
      },
      {
        "min_tokens": 0,
        "max_tokens": 20,
        "tier_label": "720p-20s",
        "per_request_price": 1.49,
        "sort_order": 1
      },
      {
        "min_tokens": 0,
        "max_tokens": 30,
        "tier_label": "720p-30s",
        "per_request_price": 1.72,
        "sort_order": 2
      }
    ]
  },
  {
    "model_name": "muse-video",
    "billing_mode": "video",
    "base_price": 0.03,
    "intervals": [
      {
        "min_tokens": 0,
        "max_tokens": null,
        "tier_label": "720p",
        "per_request_price": 0.03,
        "sort_order": 0
      }
    ]
  },
  {
    "model_name": "seedance 2.0 fast-GT",
    "billing_mode": "per_request",
    "base_price": 2.05,
    "intervals": [
      {
        "min_tokens": 0,
        "max_tokens": 10,
        "tier_label": "480p-10s",
        "per_request_price": 2.05,
        "sort_order": 0
      },
      {
        "min_tokens": 0,
        "max_tokens": 15,
        "tier_label": "480p-15s",
        "per_request_price": 3.06,
        "sort_order": 1
      },
      {
        "min_tokens": 0,
        "max_tokens": 10,
        "tier_label": "720p-10s",
        "per_request_price": 4.41,
        "sort_order": 2
      },
      {
        "min_tokens": 0,
        "max_tokens": 15,
        "tier_label": "720p-15s",
        "per_request_price": 6.61,
        "sort_order": 3
      }
    ]
  },
  {
    "model_name": "seedance 2.0 mini-GT",
    "billing_mode": "per_request",
    "base_price": 0.92,
    "intervals": [
      {
        "min_tokens": 0,
        "max_tokens": 10,
        "tier_label": "480p-10s",
        "per_request_price": 0.92,
        "sort_order": 0
      },
      {
        "min_tokens": 0,
        "max_tokens": 15,
        "tier_label": "480p-15s",
        "per_request_price": 1.38,
        "sort_order": 1
      },
      {
        "min_tokens": 0,
        "max_tokens": 10,
        "tier_label": "720p-10s",
        "per_request_price": 1.98,
        "sort_order": 2
      },
      {
        "min_tokens": 0,
        "max_tokens": 15,
        "tier_label": "720p-15s",
        "per_request_price": 2.97,
        "sort_order": 3
      }
    ]
  },
  {
    "model_name": "seedance 2.5-GT",
    "billing_mode": "video",
    "base_price": 0.88,
    "intervals": [
      {
        "min_tokens": 0,
        "max_tokens": null,
        "tier_label": "480p",
        "per_request_price": 0.88,
        "sort_order": 0
      },
      {
        "min_tokens": 0,
        "max_tokens": null,
        "tier_label": "720p",
        "per_request_price": 1.67,
        "sort_order": 1
      },
      {
        "min_tokens": 0,
        "max_tokens": null,
        "tier_label": "1080p",
        "per_request_price": 3.75,
        "sort_order": 2
      }
    ]
  },
  {
    "model_name": "seedance-2.0",
    "billing_mode": "video",
    "base_price": 0.47,
    "intervals": [
      {
        "min_tokens": 0,
        "max_tokens": null,
        "tier_label": "480p",
        "per_request_price": 0.47,
        "sort_order": 0
      },
      {
        "min_tokens": 0,
        "max_tokens": null,
        "tier_label": "720p",
        "per_request_price": 0.6,
        "sort_order": 1
      }
    ]
  },
  {
    "model_name": "seedance-2.0-fast",
    "billing_mode": "video",
    "base_price": 0.2,
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
        "per_request_price": 0.42,
        "sort_order": 1
      }
    ]
  },
  {
    "model_name": "seedance-2.0-mini",
    "billing_mode": "video",
    "base_price": 0.12,
    "intervals": [
      {
        "min_tokens": 0,
        "max_tokens": null,
        "tier_label": "480p",
        "per_request_price": 0.12,
        "sort_order": 0
      },
      {
        "min_tokens": 0,
        "max_tokens": null,
        "tier_label": "720p",
        "per_request_price": 0.22,
        "sort_order": 1
      }
    ]
  },
  {
    "model_name": "seedance-2.0-mini-Chovy",
    "billing_mode": "per_request",
    "base_price": 1.5,
    "intervals": [
      {
        "min_tokens": 0,
        "max_tokens": 5,
        "tier_label": "720p-5s",
        "per_request_price": 1.5,
        "sort_order": 0
      },
      {
        "min_tokens": 0,
        "max_tokens": 10,
        "tier_label": "720p-10s",
        "per_request_price": 1.5,
        "sort_order": 1
      },
      {
        "min_tokens": 0,
        "max_tokens": 15,
        "tier_label": "720p-15s",
        "per_request_price": 1.5,
        "sort_order": 2
      }
    ]
  },
  {
    "model_name": "seedance-2.5",
    "billing_mode": "video",
    "base_price": 0.57,
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
        "per_request_price": 0.89,
        "sort_order": 1
      }
    ]
  },
  {
    "model_name": "seedance-2.5-alioth",
    "billing_mode": "video",
    "base_price": 0.4,
    "intervals": [
      {
        "min_tokens": 0,
        "max_tokens": null,
        "tier_label": "720p",
        "per_request_price": 0.4,
        "sort_order": 0
      }
    ]
  },
  {
    "model_name": "seedance-2.5-draft-zq",
    "billing_mode": "video",
    "base_price": 0.36,
    "intervals": [
      {
        "min_tokens": 0,
        "max_tokens": null,
        "tier_label": "480p",
        "per_request_price": 0.36,
        "sort_order": 0
      }
    ]
  },
  {
    "model_name": "seedance-2.5-flash-zq",
    "billing_mode": "video",
    "base_price": 0.28,
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
        "per_request_price": 0.76,
        "sort_order": 1
      }
    ]
  },
  {
    "model_name": "seedance-2.5-merak",
    "billing_mode": "per_request",
    "base_price": 7.25,
    "intervals": [
      {
        "min_tokens": 0,
        "max_tokens": null,
        "tier_label": "480p",
        "per_request_price": 7.25,
        "sort_order": 0
      },
      {
        "min_tokens": 0,
        "max_tokens": null,
        "tier_label": "720p",
        "per_request_price": 7.25,
        "sort_order": 1
      }
    ]
  },
  {
    "model_name": "seedance2.0 fast Deneb",
    "billing_mode": "per_request",
    "base_price": 1.38,
    "intervals": [
      {
        "min_tokens": 0,
        "max_tokens": 5,
        "tier_label": "720p-5s",
        "per_request_price": 1.38,
        "sort_order": 0
      },
      {
        "min_tokens": 0,
        "max_tokens": 10,
        "tier_label": "720p-10s",
        "per_request_price": 1.38,
        "sort_order": 1
      },
      {
        "min_tokens": 0,
        "max_tokens": 15,
        "tier_label": "720p-15s",
        "per_request_price": 1.38,
        "sort_order": 2
      }
    ]
  },
  {
    "model_name": "seedance2.0 mini Love",
    "billing_mode": "video",
    "base_price": 0.12,
    "intervals": [
      {
        "min_tokens": 0,
        "max_tokens": null,
        "tier_label": "480p",
        "per_request_price": 0.12,
        "sort_order": 0
      },
      {
        "min_tokens": 0,
        "max_tokens": null,
        "tier_label": "720p",
        "per_request_price": 0.23,
        "sort_order": 1
      }
    ]
  },
  {
    "model_name": "seedance2.5 coke",
    "billing_mode": "per_request",
    "base_price": 8.05,
    "intervals": [
      {
        "min_tokens": 0,
        "max_tokens": null,
        "tier_label": "720p",
        "per_request_price": 8.05,
        "sort_order": 0
      }
    ]
  },
  {
    "model_name": "wan3.0-video",
    "billing_mode": "video",
    "base_price": 0.42,
    "intervals": [
      {
        "min_tokens": 0,
        "max_tokens": null,
        "tier_label": "480p",
        "per_request_price": 0.42,
        "sort_order": 0
      },
      {
        "min_tokens": 0,
        "max_tokens": null,
        "tier_label": "720p",
        "per_request_price": 0.8,
        "sort_order": 1
      },
      {
        "min_tokens": 0,
        "max_tokens": null,
        "tier_label": "1080p",
        "per_request_price": 1.52,
        "sort_order": 2
      }
    ]
  },
  {
    "model_name": "wan3.0-yuanlian",
    "billing_mode": "video",
    "base_price": 0.18,
    "intervals": [
      {
        "min_tokens": 0,
        "max_tokens": null,
        "tier_label": "480p",
        "per_request_price": 0.18,
        "sort_order": 0
      },
      {
        "min_tokens": 0,
        "max_tokens": null,
        "tier_label": "720p",
        "per_request_price": 0.36,
        "sort_order": 1
      },
      {
        "min_tokens": 0,
        "max_tokens": null,
        "tier_label": "1080p",
        "per_request_price": 0.68,
        "sort_order": 2
      }
    ]
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
        SET model_pricing = '[]'::jsonb,
            updated_at = NOW()
        WHERE id = current_video_group_id;
    END IF;

    FOR entry IN SELECT * FROM jsonb_array_elements(catalog_json)
    LOOP
        SELECT p.id INTO target_pricing_id
        FROM channel_model_pricing p
        WHERE p.channel_id = target_channel_id
          AND jsonb_array_length(p.models) = 1
          AND lower(p.models->>0) = lower(entry->>'model_name')
        ORDER BY p.id
        LIMIT 1;

        IF target_pricing_id IS NULL THEN
            INSERT INTO channel_model_pricing (
                channel_id, platform, models, billing_mode, per_request_price, description, created_at, updated_at
            ) VALUES (
                target_channel_id,
                'openai',
                jsonb_build_array(entry->>'model_name'),
                entry->>'billing_mode',
                (entry->>'base_price')::numeric,
                '',
                NOW(),
                NOW()
            ) RETURNING id INTO target_pricing_id;
        ELSE
            UPDATE channel_model_pricing
            SET platform = 'openai',
                billing_mode = entry->>'billing_mode',
                per_request_price = (entry->>'base_price')::numeric,
                updated_at = NOW()
            WHERE id = target_pricing_id;
        END IF;

        DELETE FROM channel_pricing_intervals WHERE pricing_id = target_pricing_id;

        FOR interval IN SELECT * FROM jsonb_array_elements(entry->'intervals')
        LOOP
            INSERT INTO channel_pricing_intervals (
                pricing_id, min_tokens, max_tokens, tier_label, per_request_price, sort_order, created_at, updated_at
            ) VALUES (
                target_pricing_id,
                (interval->>'min_tokens')::integer,
                NULLIF(interval->>'max_tokens', '')::integer,
                interval->>'tier_label',
                (interval->>'per_request_price')::numeric,
                (interval->>'sort_order')::integer,
                NOW(),
                NOW()
            );
        END LOOP;
    END LOOP;
END
$migration$;
