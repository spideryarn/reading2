blind-id: ca5db55ad6c3

1. A standard Transformer, changed as little as possible, is applied directly to an image cut into patches (linear patch embeddings, position embeddings, a class token), showing that reliance on CNNs is not necessary for image classification.
2. Trained on a mid-sized dataset such as ImageNet alone, ViT scores a few points below ResNets of similar size, because it lacks the CNN's built-in inductive biases (locality, translation equivariance).
3. With large-scale pre-training (ImageNet-21k at 14M, JFT-300M at 303M images) ViT matches or beats the state of the art (88.55% ImageNet, 94.55% CIFAR-100, 77.63% VTAB): large-scale training trumps inductive bias.
4. The data-size experiments: larger ViT models only pay off on the largest dataset, and on JFT subsets ViT is worse than a comparable ResNet at 9M images but better from 90M up.
5. ViT is substantially cheaper to pre-train (2.5k TPUv3-core-days against 9.9k for BiT-L; about 2 to 4 times less compute for the same performance in the controlled study), with the caveat that training settings may also affect efficiency, and it does not appear to saturate in the range tried.
6. Hybrids (CNN feature maps fed into the Transformer) slightly beat pure ViT at small compute budgets, but the difference vanishes for larger models.
7. Inspecting the model: position embeddings learn the 2D layout of the image on their own, and some attention heads integrate information across most of the image already in the lowest layers, with attention distance growing with depth.
8. Self-supervised masked-patch pre-training is preliminary: 79.9% on ImageNet for ViT-B/16, 2% above training from scratch but 4% behind supervised pre-training; detection, segmentation and further scaling are left as open challenges.

## G01

faults: 0

## G02

- omitted: finding 6, the hybrid models and the result that their advantage vanishes for larger models
faults: 1

## G03

- omitted: finding 6, the hybrid models and the result that their advantage vanishes for larger models
faults: 1

## G04

faults: 0

## G05

- omitted: finding 6, hybrids are named as rivals but the result (slightly better at small budgets, gap vanishes for larger models) is never given
faults: 1

## G06

faults: 0
