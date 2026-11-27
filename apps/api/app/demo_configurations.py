from .models import CreateConfiguration


DEMO_SHARE_OWNER_ID = "demo-share"
DEMO_SHARED_CONFIGURATIONS = [
    ("b69f75a7-73f6-4ee6-b774-545c0a21d4bb", "RfYTCzDAO0YBTDuFBjuG7rUmpzMaSWY3hHlaAQbtx4c", CreateConfiguration.model_validate({
        "name": "Tree Identity and Condition",
        "configuration": {
            "symbolConfig": {
                "color": {"field": "Leaf_Area", "stops": [
                    {"value": 10, "color": "#dbeafe"}, {"value": 40000, "color": "#1d4ed8"},
                ]},
                "size": {"field": "Leaf_Bmass", "stops": [
                    {"value": 0, "size": 6}, {"value": 700, "size": 24},
                ]},
            },
            "tableConfig": {"columns": ["Tree_ID", "Cmn_Name", "Condition", "Tree_Age", "Height", "Leaf_Area", "Leaf_Bmass", "Notes"]},
        },
    })),
    ("21383eb7-2f20-4e65-a67f-e99b87a683fe", "YRJH15Pu9ye3ik4q736OzqziDVa6GKLMfxfH13rePR4", CreateConfiguration.model_validate({
        "name": "Leaf and Carbon Measurements",
        "configuration": {
            "symbolConfig": {
                "color": {"field": "Leaf_Area", "stops": [
                    {"value": 10, "color": "#ede9fe"}, {"value": 40000, "color": "#6d28d9"},
                ]},
                "size": {"field": "Leaf_Bmass", "stops": [
                    {"value": 0, "size": 8}, {"value": 700, "size": 36},
                ]},
            },
            "tableConfig": {"columns": ["Tree_ID", "Cmn_Name", "Leaf_Area", "Leaf_Bmass", "C_Storage", "C_Seq", "Native", "Land_Use"]},
        },
    })),
]
