from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


# Allowed columns from the Landscape Trees dataset.
# Source: services.arcgis.com/V6ZHFr6zdgNZuVG0/arcgis/rest/services/Landscape_Trees/FeatureServer/0
# Future: Load allowed columns from dataset metadata when supporting other datasets.
COLUMN_NAMES = frozenset("""
FID Tree_ID Collected Crew Status Spp_Code Land_Use Ht_DBH_ft DBH1 DBH2 DBH3 DBH4
DBH5 DBH6 Height Live_Top Crown_Base Width_NS Width_EW Cn_Missing Cn_DieBack CLE
Tree_Site Tree_Age Notes Cmn_Name Sci_Name GroundArea Condition Leaf_Area Leaf_Bmass
LAI C_Storage C_Seq S_Value Street Native CO_Rmvd O3_Rmvd NO2_Rmvd PM10_Rmvd
SO2_Rmvd PM2p5_Rmvd CO_RVlu O3_Rvlu NO2_Rvlu PM10_Rvlu SO2_Rvlu PM2p5_RVlu
Isoprene_E Monoterp_E Vocs_E Dedication Longitude Latitude Crown_Height
""".split())


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, allow_inf_nan=False)


class ColorStop(StrictModel):
    value: float
    color: Annotated[str, Field(pattern=r"^#[0-9a-fA-F]{6}$")]


class SizeStop(StrictModel):
    value: float
    size: Annotated[float, Field(ge=1, le=100)]


class ColorSettings(StrictModel):
    field: Literal["Leaf_Area"]
    stops: Annotated[list[ColorStop], Field(min_length=2, max_length=2)]

    @field_validator("stops")
    @classmethod
    def validate_leaf_area_range(cls, stops):
        if [stop.value for stop in stops] != [10, 40000]:
            raise ValueError("Colour stops must use the current Leaf_Area range: 10, 40000.")
        return stops


class SizeSettings(StrictModel):
    field: Literal["Leaf_Bmass"]
    stops: Annotated[list[SizeStop], Field(min_length=2, max_length=2)]

    @field_validator("stops")
    @classmethod
    def validate_leaf_biomass_range(cls, stops):
        if [stop.value for stop in stops] != [0, 700]:
            raise ValueError("Size stops must use the current Leaf_Bmass range: 0, 700.")
        return stops


class SymbolSettings(StrictModel):
    color: ColorSettings
    size: SizeSettings


class TableSettings(StrictModel):
    columns: Annotated[list[str], Field(min_length=1, max_length=len(COLUMN_NAMES))]

    @field_validator("columns")
    @classmethod
    def validate_column_names(cls, columns):
        if len(set(columns)) != len(columns):
            raise ValueError("Choose each table column only once.")
        if any(column not in COLUMN_NAMES for column in columns):
            raise ValueError("Table columns must be fields in the Landscape Trees dataset.")
        return columns


class Configuration(StrictModel):
    symbolConfig: SymbolSettings
    tableConfig: TableSettings


class CreateConfiguration(StrictModel):
    name: Annotated[str, Field(min_length=1, max_length=100)]
    configuration: Configuration

    @field_validator("name", mode="before")
    @classmethod
    def trim_name(cls, name):
        return name.strip() if isinstance(name, str) else name


class ConfigurationSummary(StrictModel):
    id: str
    name: str
    visibility: Literal["private", "unlisted"]
    created_at: str


class SavedConfiguration(ConfigurationSummary):
    configuration: Configuration


class ShareConfiguration(StrictModel):
    token: str
