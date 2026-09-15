#!/usr/bin/env python3
"""
رَيّ — RAYY - Disease Prediction Model with Arabic Diagnostic Report Generator
Trained EfficientNet-B0 model for plant disease recognition.
"""

import json
import os
import sys
import argparse
from pathlib import Path

import torch
import torch.nn as nn
from torchvision import models, transforms
from PIL import Image


class SmartPlantDoctor:
    def __init__(self, model_path="plant_ai/models/best_plant_model.pth",
                 mapping_path="plant_ai/models/label_mapping.json", device=None):
        """
        Initialize the RAYY disease-detection model with EfficientNet-B0 and Arabic Knowledge Base.
        """
        self.device = device or ("cuda" if torch.cuda.is_available() else "cpu")

        print("🌱 Initializing RAYY model...")
        print(f"📂 Loading model from: {model_path}")

        if not os.path.exists(model_path):
            raise FileNotFoundError(f"Model file not found: {model_path}")

        # 1. Load Checkpoint / State Dict first to verify class counts
        checkpoint = torch.load(model_path, map_location=self.device)

        if isinstance(checkpoint, dict) and 'state_dict' in checkpoint:
            state_dict = checkpoint['state_dict']
            checkpoint_classes = checkpoint.get('classes', None)
        else:
            state_dict = checkpoint
            checkpoint_classes = None

        # 2. Determine Label Mapping & Class Count
        if os.path.exists(mapping_path):
            with open(mapping_path, "r", encoding="utf-8") as f:
                loaded_map = json.load(f)
                # Ensure keys can be accessed flexibly
                self.idx_to_label = {str(k): v for k, v in loaded_map.items()}
        elif checkpoint_classes:
            self.idx_to_label = {str(i): c for i, c in enumerate(checkpoint_classes)}
        else:
            self.idx_to_label = None

        if self.idx_to_label:
            self.num_classes = len(self.idx_to_label)
        else:
            self.num_classes = 38  # Default PlantVillage class count

        # 3. Build EfficientNet-B0 Model with correct classifier shape
        self.model = models.efficientnet_b0(weights=None)
        in_features = self.model.classifier[1].in_features
        self.model.classifier[1] = nn.Linear(in_features, self.num_classes)

        # 4. Load Trained Weights into Model
        self.model.load_state_dict(state_dict)
        self.model = self.model.to(self.device).eval()

        # Setup standard EfficientNet preprocessing transforms
        self.transform = transforms.Compose([
            transforms.Resize((224, 224)),
            transforms.ToTensor(),
            transforms.Normalize(
                mean=[0.485, 0.456, 0.406],
                std=[0.229, 0.224, 0.225]
            )
        ])

        # Load Arabic Knowledge Base & Translation Rules
        self.knowledge_base = self._load_arabic_knowledge_base()
        self.plant_translations = self._load_plant_translations()

        print(f"🏷️ Loaded {self.num_classes} disease classes successfully!")
        print(f"🖥️ Operating Device: {self.device}")

    def _load_plant_translations(self):
        """Dictionary for dynamic translation fallback"""
        return {
            "Raspberry": "العليق (Raspberry)",
            "Strawberry": "الفراولة",
            "Tomato": "الطماطم",
            "Grape": "العنب",
            "Corn_(maize)": "الذرة",
            "Apple": "التفاح",
            "Blueberry": "التوت الأزرق",
            "leaf": "أوراق",
            "healthy": "سليم"
        }

    def _load_arabic_knowledge_base(self):
        """Knowledge base mapping raw disease labels to Arabic diagnostic records"""
        return {
            "Strawberry___Leaf_scorch": {
                "plant_ar": "الفراولة (Strawberry)",
                "disease_ar": "احتراق أوراق الفراولة (Leaf Scorch)",
                "symptoms": [
                    "بقع أرجوانية إلى بنية على السطح العلوي للورقة",
                    "جفاف حواف الأوراق وتحولها للون البني",
                    "ضعف عام في نمو النبات"
                ],
                "severity": "متوسطة — Moderate (تقدير الإصابة: 20–35%)",
                "causes": [
                    "عدوى فطرية (Diplocarpon earlianum)",
                    "رطوبة متراكمة على الأوراق لفترات طويلة",
                    "ضعف التهوية بين الشتلات"
                ],
                "treatment": [
                    "أزل الأوراق المصابة المتيبسة والتخلص منها بعيداً.",
                    "تجنب الري الرشي واستخدم الري التنقيطي.",
                    "استخدم رشات وقائية من مبيد فطري مخصص للفراولة.",
                    "اترك مسافات كافية بين الشتلات لتحسين التهوية."
                ]
            },
            "Grape___Esca_(Black_Measles)": {
                "plant_ar": "العنب (Grape)",
                "disease_ar": "مرض إيسكا / الحصبة السوداء",
                "symptoms": ["بقع داكنة على الأوراق والثمار", "جفاف عام في الأغصان"],
                "severity": "عالية — Severe",
                "causes": ["عدوى فطرية مركبة في الأوعية الخشبية"],
                "treatment": ["تقليم الأجزاء المصابة ورش المطهّرات المعتمدة"]
            },
            "Corn_(maize)___Northern_Leaf_Blight": {
                "plant_ar": "الذرة (Corn)",
                "disease_ar": "لفحة أوراق الذرة الشمالية",
                "symptoms": ["آفات رمادية بيضاوية على الأوراق"],
                "severity": "متوسطة — Moderate",
                "causes": ["فطر Exserohilum turcicum"],
                "treatment": ["استخدام أصناف مقاوِمة ورش المبيدات الفطرية عند الحاجة"]
            }
        }

    def clean_label_to_arabic(self, raw_label):
        """Convert raw labels into full Arabic display strings without string truncation"""
        if raw_label in self.knowledge_base and "disease_ar" in self.knowledge_base[raw_label]:
            return self.knowledge_base[raw_label]["disease_ar"]

        translated = raw_label
        for en, ar in self.plant_translations.items():
            translated = translated.replace(en, ar)

        parts = translated.split("___")
        disease_part = parts[1] if len(parts) > 1 else parts[0]
        return disease_part.replace("_", " ")

    def _get_label_by_index(self, idx):
        """Helper to get label safely from dictionary"""
        str_idx = str(idx)
        if self.idx_to_label and str_idx in self.idx_to_label:
            return self.idx_to_label[str_idx]
        return f"Class_{idx}"

    @torch.no_grad()
    def predict(self, image_path):
        """
        Run inference on input image and return both English output and Arabic Diagnostic Report
        """
        try:
            image = Image.open(image_path).convert('RGB')
            tensor = self.transform(image).unsqueeze(0).to(self.device)

            outputs = self.model(tensor)
            probs = torch.softmax(outputs, dim=1)[0]

            # Get Top 4 Predictions
            top_probs, top_indices = torch.topk(probs, k=min(4, self.num_classes))

            top_pred_idx = top_indices[0].item()
            top_pred_label = self._get_label_by_index(top_pred_idx)
            top_conf = top_probs[0].item() * 100

            # Pull knowledge base record or build fallback
            kb = self.knowledge_base.get(top_pred_label, None)
            if not kb:
                parts = top_pred_label.split("___")
                plant_name = parts[0].replace("_", " ")
                disease_name = parts[1].replace("_", " ") if len(parts) > 1 else "Healthy"

                kb = {
                    "plant_ar": plant_name,
                    "disease_ar": disease_name,
                    "symptoms": ["بقع متفرقة على الأوراق", "تغير في لون النسيج النباتي"],
                    "severity": "متوسطة — Moderate (تقدير الإصابة: 15–30%)",
                    "causes": ["إصابة فطرية أو بكتيرية محتملة", "ظروف بيئية غير ملائمة"],
                    "treatment": ["عزل الجزء المصاب", "تقليل الرطوبة على الأوراق", "استشارة مرشد زراعي"]
                }

            # Generate Candidates Table
            candidates_table = []
            for i in range(len(top_indices)):
                idx_val = top_indices[i].item()
                lbl = self._get_label_by_index(idx_val)
                pr = top_probs[i].item() * 100
                candidates_table.append({
                    "raw_label": lbl,
                    "disease_ar": self.clean_label_to_arabic(lbl),
                    "confidence": round(pr, 1)
                })

            parts = top_pred_label.split("___")
            plant_en = parts[0]
            disease_en = parts[1] if len(parts) > 1 else "Healthy"

            return {
                'plant': plant_en,
                'disease': disease_en,
                'confidence': top_conf,
                'class_name': top_pred_label,
                'arabic_report': {
                    'plant_ar': kb['plant_ar'],
                    'disease_ar': kb['disease_ar'],
                    'health_status': "🟢 الحالة سليمة" if "healthy" in top_pred_label.lower() else "🔴 توجد علامات مرضية",
                    'symptoms': kb['symptoms'],
                    'severity': kb['severity'],
                    'causes': kb['causes'],
                    'treatment': kb['treatment'],
                    'candidates': candidates_table
                }
            }

        except Exception as e:
            return {'error': f"Failed to process image: {str(e)}"}

    def print_arabic_report(self, result):
        """Prints formatted Arabic report to stdout"""
        rep = result['arabic_report']
        print("=" * 60)
        print("🌿 تقرير تشخيص النبات")
        print("=" * 60)
        print(f"\nالنبات المُتعرف عليه: 🌱 **{rep['plant_ar']}**")
        print(f"درجة الثقة: **{result['confidence']:.1f}%**\n")
        print(f"الحالة العامة: {rep['health_status']}\n")
        print(f"التشخيص الأقرب: 🦠 **{rep['disease_ar']}**\n")

        print("### 🔎 ماذا لاحظ النظام؟")
        for sym in rep['symptoms']:
            print(f"* {sym}")

        print(f"\n### 📊 شدة الإصابة\n**{rep['severity']}**\n")

        print("### 🧪 الأسباب المحتملة")
        for idx, cause in enumerate(rep['causes'], 1):
            print(f"{idx}. {cause}")

        print("\n### 💊 ماذا تفعل الآن؟")
        for idx, step in enumerate(rep['treatment'], 1):
            print(f"**{idx}.** {step}")

        print("\n### 📌 التشخيصات المحتملة")
        print("| التشخيص | الاحتمالية |")
        print("| :--- | :---: |")
        for item in rep['candidates']:
            print(f"| {item['disease_ar']} | **{item['confidence']}%** |")

        print("\n### ⚠️ تنبيه")
        print("**هذا التشخيص مبني على تحليل الصورة بواسطة الذكاء الاصطناعي، ولا يُعد بديلاً عن الفحص الزراعي المتخصص.**")
        print("=" * 60)


def main():
    parser = argparse.ArgumentParser(description='رَيّ — RAYY - Arabic Report Generator')
    parser.add_argument('image_path', nargs='?', help='Path to the plant image')
    parser.add_argument('--model', default='plant_ai/models/best_plant_model.pth', help='Path to model weights')
    parser.add_argument('--mapping', default='plant_ai/models/label_mapping.json', help='Path to label mapping file')
    args = parser.parse_args()

    if not args.image_path:
        print("❌ Error: Please provide an image path.")
        sys.exit(1)

    doctor = SmartPlantDoctor(model_path=args.model, mapping_path=args.mapping)
    result = doctor.predict(args.image_path)

    if 'error' in result:
        print(f"❌ {result['error']}")
        sys.exit(1)

    doctor.print_arabic_report(result)


if __name__ == "__main__":
    main()