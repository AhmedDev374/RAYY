"""
Treatment knowledge base for the RAYY disease-detection model.

The deployed checkpoint (backend/app/ml/exports/smart_plant_doctor_model.pth)
was trained on the 29 classes listed in exports/class_mapping.json. Each class
name has the form "{Plant}_{PlantShort}_{Disease}", which is ambiguous to split
programmatically (e.g. "Money Plant_Money_Plant_Bacterial_Wilt"). This module
gives each known class an explicit, human-readable display name and, for
diseased classes, a structured treatment record matching the frontend's
DiagnosisResult["treatment"] shape:

    { name, symptoms, home_remedies: string[], prevention }

Healthy classes intentionally have no treatment entry - the UI only shows the
Treatment Recommendations panel when treatment data is present.
"""

from __future__ import annotations

from typing import Optional, TypedDict


class Treatment(TypedDict):
    name: str
    symptoms: str
    home_remedies: list[str]
    prevention: str


class ClassInfo(TypedDict):
    plant: str
    disease: str
    treatment: Optional[Treatment]


class DiagnosisInfo(TypedDict, total=False):
    """Clean, semantic diagnosis payload consumed by the frontend report UI.

    Everything here is user-facing and free of raw model internals (no
    ``Class_XX`` identifiers, no raw class names, no logits). The frontend
    renders this object directly — it never needs to know about the model's
    internal class index space.
    """

    plant_name: str
    plant_english_name: str
    plant_confidence: float
    health_status: str  # "healthy" | "diseased" | "unmapped"
    health_status_label_ar: str
    health_status_label_en: str
    primary_diagnosis: str
    diagnosis_english_name: str
    diagnosis_confidence: float
    observations: list[str]
    severity: str  # "low" | "moderate" | "high" | "critical"
    severity_label_ar: str
    severity_label_en: str
    affected_percentage: str
    possible_causes: list[str]
    recommendations: list[str]
    alternative_diagnoses: list[dict]
    warning: str


_KB: dict[str, ClassInfo] = {
    "Aloe Vera_Aloe_Anthracnose": {
        "plant": "Aloe Vera",
        "disease": "Anthracnose",
        "treatment": {
            "name": "Anthracnose",
            "symptoms": "Sunken, water-soaked, dark brown to black spots on the leaves that "
            "may grow rings and ooze pinkish spores in humid conditions.",
            "home_remedies": [
                "Cut away and discard the infected leaf tissue with a clean, disinfected blade.",
                "Stop overhead watering; water at the soil line instead.",
                "Apply a copper-based fungicide or neem oil spray to the remaining leaves.",
                "Move the plant to a spot with better airflow and indirect light.",
            ],
            "prevention": "Avoid wetting the leaves when watering, space plants for airflow, "
            "and remove fallen or damaged leaf debris promptly.",
        },
    },
    "Aloe Vera_Aloe_Healthy": {"plant": "Aloe Vera", "disease": "Healthy", "treatment": None},
    "Aloe Vera_Aloe_Leaf_Spot": {
        "plant": "Aloe Vera",
        "disease": "Leaf Spot",
        "treatment": {
            "name": "Leaf Spot",
            "symptoms": "Small circular brown or tan spots with a distinct border scattered "
            "across the leaf surface, sometimes with a yellow halo.",
            "home_remedies": [
                "Remove the most heavily spotted leaves to reduce spread.",
                "Reduce watering frequency and let the soil dry between waterings.",
                "Apply a mild fungicidal or neem oil spray to affected areas.",
                "Isolate the plant from other aloes until spots stop appearing.",
            ],
            "prevention": "Water at the base, keep the potting mix well-drained, and avoid "
            "crowding plants together.",
        },
    },
    "Aloe Vera_Aloe_Rust": {
        "plant": "Aloe Vera",
        "disease": "Rust",
        "treatment": {
            "name": "Rust",
            "symptoms": "Small orange, rust-colored pustules or raised bumps on the leaf "
            "surface, often surrounded by a yellowish ring.",
            "home_remedies": [
                "Remove and dispose of heavily infected leaves (do not compost them).",
                "Apply a sulfur-based or copper fungicide to remaining foliage.",
                "Increase spacing and ventilation around the plant.",
                "Avoid misting or wetting the leaves directly.",
            ],
            "prevention": "Rust spores spread in still, humid air - keep the plant in a "
            "well-ventilated, sunny spot and clean up fallen leaf debris.",
        },
    },
    "Aloe Vera_Aloe_Sunburn": {
        "plant": "Aloe Vera",
        "disease": "Sunburn / Sun Scorch",
        "treatment": {
            "name": "Sunburn / Sun Scorch",
            "symptoms": "Reddish-brown or bleached, dry patches on the side of the leaves "
            "facing direct sun, sometimes with a papery texture.",
            "home_remedies": [
                "Move the plant to a spot with bright but indirect light for a few weeks.",
                "Do not remove scorched tissue immediately - it protects the leaf beneath.",
                "Reintroduce direct sun gradually over 1-2 weeks to let the plant acclimate.",
                "Keep the plant well (but not over-) watered while it recovers.",
            ],
            "prevention": "Acclimate aloe to direct sun gradually, especially after moving it "
            "indoors-to-outdoors or through a heatwave.",
        },
    },
    "Chrysanthemum_Chrysanthemum_Bacterial_Leaf_Spot": {
        "plant": "Chrysanthemum",
        "disease": "Bacterial Leaf Spot",
        "treatment": {
            "name": "Bacterial Leaf Spot",
            "symptoms": "Irregular, water-soaked brown spots that may merge into larger dead "
            "patches, often with a yellow halo around each spot.",
            "home_remedies": [
                "Remove and discard infected leaves; disinfect tools between cuts.",
                "Avoid overhead watering and misting the foliage.",
                "Apply a copper-based bactericide spray if symptoms are spreading.",
                "Improve air circulation between plants.",
            ],
            "prevention": "Water at the soil level, avoid working with plants while foliage "
            "is wet, and rotate planting locations each season.",
        },
    },
    "Chrysanthemum_Chrysanthemum_Healthy": {
        "plant": "Chrysanthemum",
        "disease": "Healthy",
        "treatment": None,
    },
    "Chrysanthemum_Chrysanthemum_Septoria_Leaf_Spot": {
        "plant": "Chrysanthemum",
        "disease": "Septoria Leaf Spot",
        "treatment": {
            "name": "Septoria Leaf Spot",
            "symptoms": "Small, dark brown-to-black circular spots that start on lower "
            "leaves and spread upward, eventually causing yellowing and leaf drop.",
            "home_remedies": [
                "Remove and destroy infected lower leaves as soon as they appear.",
                "Apply a fungicide labeled for Septoria on ornamentals.",
                "Clear fallen infected leaf litter from around the base of the plant.",
                "Water early in the day so foliage dries quickly.",
            ],
            "prevention": "Space plants for airflow, avoid overhead irrigation, and remove "
            "plant debris at the end of the season.",
        },
    },
    "Hibiscus_Hibiscus_Blight": {
        "plant": "Hibiscus",
        "disease": "Blight",
        "treatment": {
            "name": "Blight",
            "symptoms": "Rapidly browning or blackening leaves and stems, sometimes with a "
            "soft, water-soaked appearance and wilting shoots.",
            "home_remedies": [
                "Prune out and discard affected stems and leaves well below the damage.",
                "Reduce watering and improve soil drainage.",
                "Apply a broad-spectrum fungicide to remaining healthy growth.",
                "Keep the plant away from other stressed or wet foliage.",
            ],
            "prevention": "Avoid overwatering, ensure pots/soil drain well, and prune to keep "
            "the canopy open for airflow.",
        },
    },
    "Hibiscus_Hibiscus_Healthy": {"plant": "Hibiscus", "disease": "Healthy", "treatment": None},
    "Hibiscus_Hibiscus_Necrosis": {
        "plant": "Hibiscus",
        "disease": "Necrosis",
        "treatment": {
            "name": "Necrosis",
            "symptoms": "Patches of dead, dark brown or black tissue on leaves or stems, "
            "often starting at the leaf margin or tip.",
            "home_remedies": [
                "Remove dead/necrotic tissue with clean, disinfected pruners.",
                "Check for and correct root-bound or waterlogged soil conditions.",
                "Ease off fertilizer until the plant recovers - nutrient burn can mimic this.",
                "Isolate the plant while monitoring for spread.",
            ],
            "prevention": "Avoid over-fertilizing, keep watering consistent, and check roots "
            "periodically for rot.",
        },
    },
    "Hibiscus_Hibiscus_Scorch": {
        "plant": "Hibiscus",
        "disease": "Leaf Scorch",
        "treatment": {
            "name": "Leaf Scorch",
            "symptoms": "Dry, brown, crispy edges or tips on leaves, often with the interior "
            "of the leaf still green.",
            "home_remedies": [
                "Move the plant out of intense, direct afternoon sun temporarily.",
                "Water deeply and consistently, especially in hot weather.",
                "Increase humidity around the plant if the air is very dry.",
                "Trim off badly scorched leaf tips for appearance; new growth should be fine.",
            ],
            "prevention": "Keep watering consistent during heat, and give the plant some "
            "afternoon shade in very hot climates.",
        },
    },
    "Money Plant_Money_Plant_Bacterial_Wilt": {
        "plant": "Money Plant (Pothos)",
        "disease": "Bacterial Wilt",
        "treatment": {
            "name": "Bacterial Wilt",
            "symptoms": "Sudden wilting or drooping of leaves and stems despite adequate "
            "soil moisture, sometimes with a foul smell from the stem base.",
            "home_remedies": [
                "Check the roots and stem base for soft, mushy, discolored tissue and trim it away.",
                "Repot into fresh, well-draining soil if the current mix is soggy.",
                "Reduce watering frequency significantly until new growth appears.",
                "Take healthy cuttings to propagate a new plant if the original is heavily affected.",
            ],
            "prevention": "Use well-draining potting mix, avoid letting the pot sit in "
            "standing water, and sanitize cutting tools between plants.",
        },
    },
    "Money Plant_Money_Plant_Chlorosis": {
        "plant": "Money Plant (Pothos)",
        "disease": "Chlorosis (Nutrient Deficiency)",
        "treatment": {
            "name": "Chlorosis (Nutrient Deficiency)",
            "symptoms": "Yellowing of leaves, often between the veins while the veins stay "
            "green, most noticeable on newer growth.",
            "home_remedies": [
                "Feed with a balanced houseplant fertilizer containing iron and magnesium.",
                "Check soil pH - very alkaline soil blocks iron uptake in pothos.",
                "Ensure the plant is getting enough indirect light.",
                "Flush the soil if fertilizer salts may have built up.",
            ],
            "prevention": "Feed on a regular light schedule during the growing season and "
            "avoid letting fertilizer salts accumulate in the pot.",
        },
    },
    "Money Plant_Money_Plant_Healthy": {
        "plant": "Money Plant (Pothos)",
        "disease": "Healthy",
        "treatment": None,
    },
    "Money Plant_Money_Plant_Manganese_Toxicity": {
        "plant": "Money Plant (Pothos)",
        "disease": "Manganese Toxicity",
        "treatment": {
            "name": "Manganese Toxicity",
            "symptoms": "Small brown or black speckled spots scattered across older leaves, "
            "sometimes with a slight leaf curl.",
            "home_remedies": [
                "Stop fertilizing for several weeks to let excess nutrients dissipate.",
                "Flush the soil thoroughly with plain water to leach out excess minerals.",
                "Repot into fresh soil if toxicity is severe or long-standing.",
                "Remove the worst-affected older leaves for appearance.",
            ],
            "prevention": "Avoid over-fertilizing and use a balanced, diluted fertilizer on a "
            "conservative schedule.",
        },
    },
    "Rose_Rose_Black_Spot": {
        "plant": "Rose",
        "disease": "Black Spot",
        "treatment": {
            "name": "Black Spot",
            "symptoms": "Circular black spots with fringed edges on leaves, usually "
            "surrounded by a yellow halo, leading to premature leaf drop.",
            "home_remedies": [
                "Remove and destroy fallen and infected leaves - do not compost them.",
                "Apply a fungicide labeled for black spot on roses.",
                "Prune for better airflow through the center of the bush.",
                "Water at the base early in the day so leaves dry quickly.",
            ],
            "prevention": "Choose resistant varieties where possible, avoid wetting foliage, "
            "and clean up leaf litter every fall.",
        },
    },
    "Rose_Rose_Downy_Mildew": {
        "plant": "Rose",
        "disease": "Downy Mildew",
        "treatment": {
            "name": "Downy Mildew",
            "symptoms": "Purple-to-brown irregular blotches on the upper leaf surface with a "
            "grayish, fuzzy growth on the underside in humid conditions.",
            "home_remedies": [
                "Remove and discard infected leaves promptly.",
                "Improve air circulation and reduce humidity around the plant.",
                "Apply a fungicide effective against downy mildew.",
                "Avoid overhead watering, especially in the evening.",
            ],
            "prevention": "Keep foliage dry, prune for airflow, and avoid overcrowding rose bushes.",
        },
    },
    "Rose_Rose_Healthy": {"plant": "Rose", "disease": "Healthy", "treatment": None},
    "Rose_Rose_Insect_Damage": {
        "plant": "Rose",
        "disease": "Insect Damage",
        "treatment": {
            "name": "Insect Damage",
            "symptoms": "Chewed or ragged leaf edges, small holes throughout the leaf, or "
            "visible pests such as aphids, thrips, or beetles.",
            "home_remedies": [
                "Rinse the plant with a strong stream of water to dislodge soft-bodied pests.",
                "Apply insecticidal soap or neem oil, covering the undersides of leaves.",
                "Handpick larger pests such as beetles where practical.",
                "Introduce or attract natural predators like ladybugs for aphids.",
            ],
            "prevention": "Inspect plants regularly, especially new growth, and treat "
            "infestations early before they spread.",
        },
    },
    "Rose_Rose_Mosaic_Virus": {
        "plant": "Rose",
        "disease": "Mosaic Virus",
        "treatment": {
            "name": "Mosaic Virus",
            "symptoms": "Yellow mottled or wavy line patterns on the leaves, sometimes with "
            "stunted or distorted new growth.",
            "home_remedies": [
                "There is no cure - remove severely affected canes to reduce virus load.",
                "Disinfect pruning tools between cuts and between plants.",
                "Control aphids, which can spread the virus between roses.",
                "Avoid propagating cuttings from an infected plant.",
            ],
            "prevention": "Buy certified virus-free stock, control sap-feeding insects, and "
            "sanitize tools between plants.",
        },
    },
    "Rose_Rose_Powdery_Mildew": {
        "plant": "Rose",
        "disease": "Powdery Mildew",
        "treatment": {
            "name": "Powdery Mildew",
            "symptoms": "A white or gray powdery coating on leaves, buds, and stems, often "
            "causing leaves to curl or distort.",
            "home_remedies": [
                "Prune off heavily coated leaves and buds.",
                "Apply a fungicide, or a diluted baking-soda/horticultural-oil spray, weekly.",
                "Increase spacing and prune to improve airflow through the plant.",
                "Water at the base rather than misting the foliage.",
            ],
            "prevention": "Plant in full sun with good airflow, and avoid excess nitrogen "
            "fertilizer which encourages susceptible soft growth.",
        },
    },
    "Rose_Rose_Rust": {
        "plant": "Rose",
        "disease": "Rust",
        "treatment": {
            "name": "Rust",
            "symptoms": "Small orange, powdery pustules on the undersides of leaves, with "
            "yellow blotches visible on the top surface.",
            "home_remedies": [
                "Remove and destroy infected leaves and any fallen debris.",
                "Apply a fungicide labeled for rose rust at the first sign of infection.",
                "Avoid wetting foliage when watering.",
                "Improve airflow by pruning crowded growth.",
            ],
            "prevention": "Clean up fallen leaves each season and space plants to reduce "
            "humidity around the foliage.",
        },
    },
    "Rose_Rose_Yellow_Mosaic_Virus": {
        "plant": "Rose",
        "disease": "Yellow Mosaic Virus",
        "treatment": {
            "name": "Yellow Mosaic Virus",
            "symptoms": "Bright yellow mosaic or net-like patterns along the leaf veins, "
            "sometimes with mild leaf distortion.",
            "home_remedies": [
                "There is no cure - prune out and destroy the most affected canes.",
                "Disinfect tools between cuts and between different rose plants.",
                "Manage aphids and other sap-feeding insects that can spread the virus.",
                "Avoid taking propagation cuttings from infected plants.",
            ],
            "prevention": "Source certified disease-free plants and control insect vectors "
            "promptly.",
        },
    },
    "Turmeric_Turmeric_Aphid_Infestation": {
        "plant": "Turmeric",
        "disease": "Aphid Infestation",
        "treatment": {
            "name": "Aphid Infestation",
            "symptoms": "Clusters of small green, black, or yellow insects on new growth and "
            "leaf undersides, often with sticky residue (honeydew) and curling leaves.",
            "home_remedies": [
                "Spray leaves with a strong jet of water to knock aphids off.",
                "Apply insecticidal soap or neem oil, focusing on leaf undersides.",
                "Encourage natural predators such as ladybugs and lacewings.",
                "Wipe off honeydew and any sooty mold with a damp cloth.",
            ],
            "prevention": "Inspect new growth regularly and treat small aphid colonies before "
            "they multiply.",
        },
    },
    "Turmeric_Turmeric_Blotch": {
        "plant": "Turmeric",
        "disease": "Leaf Blotch",
        "treatment": {
            "name": "Leaf Blotch",
            "symptoms": "Irregular, elongated brown-to-gray blotches on the leaves that can "
            "merge and cause large areas of leaf tissue to die back.",
            "home_remedies": [
                "Remove and destroy severely blotched leaves.",
                "Apply a fungicide labeled for leaf blotch on turmeric or ginger family plants.",
                "Improve drainage and avoid waterlogging around the rhizomes.",
                "Space plants to reduce humidity and improve airflow.",
            ],
            "prevention": "Rotate planting beds each season and avoid overhead irrigation "
            "late in the day.",
        },
    },
    "Turmeric_Turmeric_Healthy": {"plant": "Turmeric", "disease": "Healthy", "treatment": None},
    "Turmeric_Turmeric_Leaf_Necrosis": {
        "plant": "Turmeric",
        "disease": "Leaf Necrosis",
        "treatment": {
            "name": "Leaf Necrosis",
            "symptoms": "Dead, dry brown-to-black tissue on leaf margins or tips, sometimes "
            "spreading inward across the leaf blade.",
            "home_remedies": [
                "Trim away dead tissue with clean, disinfected scissors.",
                "Check soil moisture and drainage - both drought stress and waterlogging can cause this.",
                "Ease off fertilizer temporarily to rule out nutrient burn.",
                "Water consistently and mulch to retain even soil moisture.",
            ],
            "prevention": "Maintain consistent watering and well-draining soil to avoid the "
            "moisture stress that leads to necrosis.",
        },
    },
    "Turmeric_Turmeric_Leaf_Spot": {
        "plant": "Turmeric",
        "disease": "Leaf Spot",
        "treatment": {
            "name": "Leaf Spot",
            "symptoms": "Small, round to oval brown spots with darker borders scattered "
            "across the leaf surface.",
            "home_remedies": [
                "Remove the most heavily spotted leaves to slow spread.",
                "Apply a copper-based or general fungicide to remaining foliage.",
                "Avoid overhead watering; water at the base instead.",
                "Improve spacing and airflow between plants.",
            ],
            "prevention": "Keep foliage dry, avoid overcrowding, and clear fallen infected "
            "leaves promptly.",
        },
    },
}


def lookup(class_name: str) -> Optional[ClassInfo]:
    """Return the known display/treatment info for a class name, or None if unrecognized."""
    return _KB.get(class_name)


def fallback_split(class_name: str) -> tuple[str, str]:
    """Best-effort plant/disease split for a class name not present in the knowledge base."""
    if "_" in class_name:
        plant, rest = class_name.split("_", 1)
        return plant, rest.replace("_", " ")
    return class_name, "Unknown"
