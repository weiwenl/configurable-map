from .models import CreateConfiguration


DEFAULT_CONFIGURATION_ID = "system-default"
SYSTEM_OWNER_ID = "system"
DEFAULT_CONFIGURATION = CreateConfiguration.model_validate({
    "name": "System default",
    "configuration": {
        "symbolConfig": {
            "color": {"field": "Leaf_Area", "stops": [
                {"value": 10, "color": "#ffffff"},
                {"value": 40000, "color": "#00fd00"},
            ]},
            "size": {"field": "Leaf_Bmass", "stops": [
                {"value": 0, "size": 5},
                {"value": 700, "size": 40},
            ]},
        },
        "tableConfig": {"columns": ["Leaf_Area", "Leaf_Bmass"]},
    },
})
