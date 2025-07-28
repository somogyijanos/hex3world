# Asset Pack Schema Draft
```json
{
  "title": "AssetPack",
  "type": "object",
  "required": ["id", "name", "version", "geometry_config", "materials", "edge_types", "tiles", "addons"],
  "properties": {
    "id": { "type": "string" },
    "name": { "type": "string" },
    "version": { "type": "string" },
    "description": { "type": "string" },
    "geometry_config": {
      "type": "object",
      "required": ["tile_up_axis", "parallel_edge_direction"],
      "properties": {
        "tile_up_axis": {
          "type": "string",
          "enum": ["x+", "x-", "y+", "y-", "z+", "z-"]
        },
        "parallel_edge_direction": {
          "type": "string",
          "enum": ["x+", "x-", "y+", "y-", "z+", "z-"]
        }
      }
    },
    "materials": {
      "type": "array",
      "items": { "type": "string" }
    },
    "edge_types": {
      "type": "object",
      "additionalProperties": {
        "type": "object",
        "required": ["materials"],
        "properties": {
          "materials": {
            "type": "array",
            "items": { "type": "string" }
          },
          "compatible_with": {
            "type": "array",
            "items": { "type": "string" }
          }
        }
      }
    },
    "tiles": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["id", "model", "edges"],
        "properties": {
          "id": { "type": "string" },
          "model": { "type": "string" },
          "base_material": { "type": "string" },
          "tags": {
            "type": "array",
            "items": { "type": "string" }
          },
          "edges": {
            "type": "array",
            "items": { "type": "string" },
            "minItems": 6,
            "maxItems": 6
          },
          "vertices": {
            "type": "array",
            "items": {
              "type": "array",
              "items": { "type": "string" }
            },
            "minItems": 6,
            "maxItems": 6
          },
          "placement_rules": {
            "type": "object",
            "properties": {
              "incompatible_neighbors": {
                "type": "array",
                "items": { "type": "string" }
              }
            }
          }
        }
      }
    },
    "addons": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["id", "model", "placement"],
        "properties": {
          "id": { "type": "string" },
          "model": { "type": "string" },
          "tags": {
            "type": "array",
            "items": { "type": "string" }
          },
          "placement": {
            "type": "object",
            "required": ["tile_tags", "local_position", "local_rotation", "local_scale"],
            "properties": {
              "tile_tags": {
                "type": "array",
                "items": { "type": "string" }
              },
              "local_position": {
                "type": "array",
                "items": { "type": "number" },
                "minItems": 3,
                "maxItems": 3
              },
              "local_rotation": { "type": "number" },
              "local_scale": { "type": "number" }
            }
          }
        }
      }
    }
  }
}
```

# World Schema Draft
```json
{
  "title": "World",
  "type": "object",
  "required": ["asset_pack", "tiles", "addons"],
  "properties": {
    "asset_pack": { "type": "string" },
    "tiles": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["tile_type", "q", "r", "elevation"],
        "properties": {
          "tile_type": { "type": "string" },
          "q": { "type": "integer" },
          "r": { "type": "integer" },
          "elevation": { "type": "number" }
        }
      }
    },
    "addons": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["addon_id", "q", "r", "local_position", "local_rotation", "local_scale"],
        "properties": {
          "addon_id": { "type": "string" },
          "q": { "type": "integer" },
          "r": { "type": "integer" },
          "local_position": {
            "type": "array",
            "items": { "type": "number" },
            "minItems": 3,
            "maxItems": 3
          },
          "local_rotation": { "type": "number" },
          "local_scale": { "type": "number" }
        }
      }
    }
  }
}
```